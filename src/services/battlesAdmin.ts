import { pool, tx, type DbClient } from '../db/pool.js';
import { AppError } from '../lib/errors.js';
import { buildPaginationClause, normalizePagination } from '../lib/pagination.js';
import { DEFAULT_MATCH_STATUS, isMatchStatus, MatchStatus } from '../lib/status.js';
import { resolveCdnUrl } from './media.js';

type AdminBattleRow = {
  id: string;
  round_id: string;
  starts_at: string | null;
  ends_at: string | null;
  status: string;
  winner_match_track_id: string | null;
  round_number: number;
  round_kind: string;
  round_status: string;
  round_scoring: string;
  round_strategy: string;
  tournament_id: string;
  tournament_title: string;
};

type AdminBattleParticipantRow = {
  match_id: string;
  participant_id: string;
  seed: number | null;
  user_id: string;
  display_name: string;
  city: string | null;
  age: number | null;
  avatar_key: string | null;
};

interface AdminBattleParticipantResponse {
  participant_id: string;
  user_id: string;
  display_name: string;
  seed: number | null;
  city: string | null;
  age: number | null;
  avatar: {
    key: string;
    url: string | null;
  } | null;
}

interface AdminBattleResponse {
  id: string;
  round_id: string;
  starts_at: string | null;
  ends_at: string | null;
  status: MatchStatus;
  winner_match_track_id: string | null;
  round: {
    id: string;
    number: number;
    kind: string;
    status: string;
    scoring: string;
    strategy: string;
  };
  tournament: {
    id: string;
    title: string;
  };
  participants: AdminBattleParticipantResponse[];
}

function mapParticipantRow(row: AdminBattleParticipantRow): AdminBattleParticipantResponse {
  return {
    participant_id: row.participant_id,
    user_id: row.user_id,
    display_name: row.display_name,
    seed: row.seed,
    city: row.city,
    age: row.age !== null && row.age !== undefined ? Number(row.age) : null,
    avatar: row.avatar_key
      ? {
          key: row.avatar_key,
          url: resolveCdnUrl(row.avatar_key),
        }
      : null,
  };
}

function mapBattleRow(
  row: AdminBattleRow,
  participantsByMatch: Map<string, AdminBattleParticipantRow[]>,
): AdminBattleResponse {
  const participants = participantsByMatch.get(row.id) ?? [];
  const status = isMatchStatus(row.status) ? (row.status as MatchStatus) : DEFAULT_MATCH_STATUS;
  return {
    id: row.id,
    round_id: row.round_id,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status,
    winner_match_track_id: row.winner_match_track_id,
    round: {
      id: row.round_id,
      number: row.round_number,
      kind: row.round_kind,
      status: row.round_status,
      scoring: row.round_scoring,
      strategy: row.round_strategy,
    },
    tournament: {
      id: row.tournament_id,
      title: row.tournament_title,
    },
    participants: participants.map(mapParticipantRow),
  };
}

async function loadParticipantsMap(
  matchIds: string[],
  client?: DbClient,
): Promise<Map<string, AdminBattleParticipantRow[]>> {
  const map = new Map<string, AdminBattleParticipantRow[]>();
  if (matchIds.length === 0) {
    return map;
  }
  const executor: DbClient | typeof pool = client ?? pool;
  const { rows } = await executor.query<AdminBattleParticipantRow>(
    `SELECT
        mp.match_id,
        mp.participant_id,
        mp.seed,
        tp.user_id,
        u.display_name,
        ap.city,
        ap.age,
        ap.avatar_key
     FROM match_participant mp
     JOIN tournament_participant tp ON tp.id = mp.participant_id
     JOIN app_user u ON u.id = tp.user_id
     LEFT JOIN artist_profile ap ON ap.user_id = tp.user_id
     WHERE mp.match_id = ANY($1::uuid[])
     ORDER BY mp.match_id, mp.seed NULLS LAST, u.display_name`,
    [matchIds],
  );

  for (const row of rows) {
    if (!map.has(row.match_id)) {
      map.set(row.match_id, []);
    }
    map.get(row.match_id)!.push(row);
  }

  return map;
}

export const listAdminBattles = async (params: {
  page?: number;
  limit?: number;
  status?: MatchStatus;
  round_id?: string;
  tournament_id?: string;
}) => {
  const pagination = normalizePagination(params.page, params.limit);
  const { limit, offset } = buildPaginationClause(pagination);

  const filters: string[] = [];
  const values: unknown[] = [];

  if (params.status) {
    values.push(params.status);
    filters.push(`m.status = $${values.length}`);
  }

  if (params.round_id) {
    values.push(params.round_id);
    filters.push(`m.round_id = $${values.length}`);
  }

  if (params.tournament_id) {
    values.push(params.tournament_id);
    filters.push(`t.id = $${values.length}`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const dataQuery = `
    SELECT
      m.id,
      m.round_id,
      m.starts_at,
      m.ends_at,
      m.status,
      m.winner_match_track_id,
      r.number AS round_number,
      r.kind AS round_kind,
      r.status AS round_status,
      r.scoring AS round_scoring,
      r.strategy AS round_strategy,
      t.id AS tournament_id,
      t.title AS tournament_title
    FROM match m
    JOIN round r ON r.id = m.round_id
    JOIN tournament t ON t.id = r.tournament_id
    ${whereClause}
    ORDER BY m.starts_at DESC NULLS LAST, m.id
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM match m
    JOIN round r ON r.id = m.round_id
    JOIN tournament t ON t.id = r.tournament_id
    ${whereClause}
  `;

  const [dataResult, countResult] = await Promise.all([
    pool.query<AdminBattleRow>(dataQuery, [...values, limit, offset]),
    pool.query<{ total: number }>(countQuery, values),
  ]);

  const matches = dataResult.rows;
  const participantsMap = await loadParticipantsMap(matches.map((row) => row.id));

  return {
    data: matches.map((row) => mapBattleRow(row, participantsMap)),
    page: pagination.page,
    limit: pagination.limit,
    total: countResult.rows[0]?.total ?? 0,
  };
};

export const getAdminBattle = async (battleId: string): Promise<AdminBattleResponse | null> => {
  const { rows } = await pool.query<AdminBattleRow>(
    `SELECT
        m.id,
        m.round_id,
        m.starts_at,
        m.ends_at,
        m.status,
        m.winner_match_track_id,
        r.number AS round_number,
        r.kind AS round_kind,
        r.status AS round_status,
        r.scoring AS round_scoring,
        r.strategy AS round_strategy,
        t.id AS tournament_id,
        t.title AS tournament_title
     FROM match m
     JOIN round r ON r.id = m.round_id
     JOIN tournament t ON t.id = r.tournament_id
     WHERE m.id = $1
     LIMIT 1`,
    [battleId],
  );

  const battle = rows[0];
  if (!battle) {
    return null;
  }

  const participantsMap = await loadParticipantsMap([battle.id]);
  return mapBattleRow(battle, participantsMap);
};

type ParticipantInput = {
  participant_id: string;
  seed?: number | null;
};

type NormalizedParticipant = {
  participant_id: string;
  seed: number | null;
};

async function ensureRound(
  client: DbClient,
  roundId: string,
): Promise<{ round_id: string; tournament_id: string }> {
  const { rows } = await client.query<{ id: string; tournament_id: string }>(
    `SELECT id, tournament_id FROM round WHERE id = $1`,
    [roundId],
  );
  const round = rows[0];
  if (!round) {
    throw new AppError({ status: 404, code: 'round_not_found', message: 'Round not found.' });
  }
  return { round_id: round.id, tournament_id: round.tournament_id };
}

async function validateParticipants(
  client: DbClient,
  participantInputs: ParticipantInput[],
  tournamentId: string,
): Promise<NormalizedParticipant[]> {
  if (!participantInputs.length) {
    throw new AppError({ status: 400, code: 'participants_required', message: 'At least one participant is required.' });
  }

  const ids = participantInputs.map((p) => p.participant_id);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size !== ids.length) {
    throw new AppError({
      status: 400,
      code: 'participant_duplicate',
      message: 'Battle participants must be unique.',
    });
  }

  const { rows } = await client.query<{ id: string; tournament_id: string }>(
    `SELECT id, tournament_id FROM tournament_participant WHERE id = ANY($1::uuid[])`,
    [ids],
  );

  if (rows.length !== ids.length) {
    throw new AppError({
      status: 400,
      code: 'participant_not_found',
      message: 'One or more participants were not found.',
    });
  }

  for (const row of rows) {
    if (row.tournament_id !== tournamentId) {
      throw new AppError({
        status: 400,
        code: 'participant_mismatch',
        message: 'Participants must belong to the same tournament as the round.',
      });
    }
  }

  const usedSeeds = new Set<number>();
  const normalized: NormalizedParticipant[] = [];

  for (const entry of participantInputs) {
    const seed = entry.seed ?? null;
    if (seed !== null) {
      if (usedSeeds.has(seed)) {
        throw new AppError({
          status: 400,
          code: 'seed_duplicate',
          message: 'Seeds must be unique when provided.',
        });
      }
      usedSeeds.add(seed);
    }
    normalized.push({
      participant_id: entry.participant_id,
      seed,
    });
  }

  return normalized;
}

export const createAdminBattle = async (payload: {
  round_id: string;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: MatchStatus;
  participants: ParticipantInput[];
}) => {
  if (!payload.participants || payload.participants.length < 2) {
    throw new AppError({
      status: 400,
      code: 'participants_minimum',
      message: 'A battle must contain at least two participants.',
    });
  }

  return tx(async (client) => {
    const round = await ensureRound(client, payload.round_id);
    const participants = await validateParticipants(client, payload.participants, round.tournament_id);
    const status = payload.status ?? DEFAULT_MATCH_STATUS;

    const matchInsert = await client.query<{ id: string }>(
      `INSERT INTO match(round_id, starts_at, ends_at, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [round.round_id, payload.starts_at ?? null, payload.ends_at ?? null, status],
    );

    const matchId = matchInsert.rows[0]?.id;
    if (!matchId) {
      throw new AppError({ status: 500, code: 'battle_create_failed', message: 'Failed to create battle.' });
    }

    for (const participant of participants) {
      await client.query(
        `INSERT INTO match_participant(match_id, participant_id, seed)
         VALUES ($1, $2, $3)`,
        [matchId, participant.participant_id, participant.seed],
      );
    }

    return matchId;
  }).then((matchId) => getAdminBattle(matchId));
};

export const updateAdminBattle = async (
  battleId: string,
  payload: {
    round_id?: string;
    starts_at?: string | null;
    ends_at?: string | null;
    status?: MatchStatus;
    participants?: ParticipantInput[];
  },
) => {
  let updatedBattleId: string | null = null;

  await tx(async (client) => {
    const existing = await client.query<{ id: string; round_id: string; tournament_id: string }>(
      `SELECT m.id, m.round_id, r.tournament_id
       FROM match m
       JOIN round r ON r.id = m.round_id
       WHERE m.id = $1`,
      [battleId],
    );

    const current = existing.rows[0];
    if (!current) {
      throw new AppError({ status: 404, code: 'battle_not_found', message: 'Battle not found.' });
    }

    let targetRoundId = current.round_id;
    let targetTournamentId = current.tournament_id;

    if (payload.round_id && payload.round_id !== current.round_id) {
      const round = await ensureRound(client, payload.round_id);
      targetRoundId = round.round_id;
      targetTournamentId = round.tournament_id;
    }

    if (payload.participants) {
      if (payload.participants.length < 2) {
        throw new AppError({
          status: 400,
          code: 'participants_minimum',
          message: 'A battle must contain at least two participants.',
        });
      }
      const participants = await validateParticipants(client, payload.participants, targetTournamentId);
      await client.query(`DELETE FROM match_participant WHERE match_id = $1`, [battleId]);
      for (const participant of participants) {
        await client.query(
          `INSERT INTO match_participant(match_id, participant_id, seed)
           VALUES ($1, $2, $3)`,
          [battleId, participant.participant_id, participant.seed],
        );
      }
    }

    const updates: string[] = [];
    const values: unknown[] = [];

    if (payload.round_id && payload.round_id !== current.round_id) {
      updates.push(`round_id = $${updates.length + 1}`);
      values.push(targetRoundId);
    }

    if (payload.starts_at !== undefined) {
      updates.push(`starts_at = $${updates.length + 1}`);
      values.push(payload.starts_at ?? null);
    }

    if (payload.ends_at !== undefined) {
      updates.push(`ends_at = $${updates.length + 1}`);
      values.push(payload.ends_at ?? null);
    }

    if (payload.status !== undefined) {
      updates.push(`status = $${updates.length + 1}`);
      values.push(payload.status ?? DEFAULT_MATCH_STATUS);
    }

    if (updates.length) {
      await client.query(
        `UPDATE match
         SET ${updates.join(', ')}
         WHERE id = $${updates.length + 1}`,
        [...values, battleId],
      );
    }

    updatedBattleId = battleId;
  });

  if (!updatedBattleId) {
    return getAdminBattle(battleId);
  }
  return getAdminBattle(updatedBattleId);
};

export const deleteAdminBattle = async (battleId: string) => {
  const result = await pool.query(`DELETE FROM match WHERE id = $1`, [battleId]);
  if (result.rowCount === 0) {
    throw new AppError({ status: 404, code: 'battle_not_found', message: 'Battle not found.' });
  }
};
