import { pool } from '../db/pool.js';
import { normalizePagination, buildPaginationClause } from '../lib/pagination.js';

export const listTournaments = async (params: { status?: string; page?: number; limit?: number }) => {
  const pagination = normalizePagination(params.page, params.limit);
  const { limit, offset } = buildPaginationClause(pagination);

  const filters: string[] = [];
  const values: unknown[] = [];

  if (params.status) {
    filters.push('status = $' + (values.length + 1));
    values.push(params.status);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const dataQuery = `SELECT id, title, status, registration_open_at, submission_deadline_at, judging_deadline_at, public_at
                     FROM tournament
                     ${where}
                     ORDER BY created_at DESC
                     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
  values.push(limit, offset);

  const { rows } = await pool.query(dataQuery, values);

  const countQuery = `SELECT COUNT(*)::int AS total FROM tournament ${where}`;
  const { rows: countRows } = await pool.query<{ total: number }>(countQuery, filters.length ? values.slice(0, filters.length) : []);

  return {
    data: rows,
    page: pagination.page,
    limit: pagination.limit,
    total: countRows[0]?.total ?? 0,
  };
};

export const getTournament = async (id: string) => {
  const { rows } = await pool.query(
    `SELECT id, title, status, registration_open_at, submission_deadline_at, judging_deadline_at, public_at
     FROM tournament WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
};

export const listRoundsForTournament = async (tournamentId: string) => {
  const { rows } = await pool.query(
    `SELECT id, tournament_id, kind, number, scoring, status, starts_at, submission_deadline_at, judging_deadline_at, strategy
     FROM round WHERE tournament_id = $1
     ORDER BY number`,
    [tournamentId]
  );
  return rows;
};

export const getRound = async (roundId: string) => {
  const { rows } = await pool.query(
    `SELECT id, tournament_id, kind, number, scoring, status, starts_at, submission_deadline_at, judging_deadline_at, strategy
     FROM round WHERE id = $1`,
    [roundId]
  );
  return rows[0] ?? null;
};

export const listMatchesForRound = async (roundId: string) => {
  const { rows } = await pool.query(
    `SELECT id, round_id, starts_at, status, ends_at, winner_match_track_id
     FROM match WHERE round_id = $1
     ORDER BY starts_at NULLS LAST, id`,
    [roundId]
  );
  return rows;
};

export const listMatchTracks = async (matchId: string) => {
  const { rows } = await pool.query(
    `SELECT mt.id, mt.match_id, mt.participant_id, mt.audio_id, mt.lyrics, mt.submitted_at,
            ma.storage_key, ma.mime, ma.duration_sec
     FROM match_track mt
     JOIN media_asset ma ON ma.id = mt.audio_id
     WHERE mt.match_id = $1`,
    [matchId]
  );
  return rows;
};

export const getMatch = async (matchId: string) => {
  const { rows } = await pool.query(
    `SELECT m.id, m.round_id, m.starts_at, m.status, m.ends_at, m.winner_match_track_id,
            r.status as round_status, r.judging_deadline_at
     FROM match m
     JOIN round r ON r.id = m.round_id
     WHERE m.id = $1`,
    [matchId]
  );
  return rows[0] ?? null;
};

export const getLeaderboard = async (tournamentId: string) => {
  const { rows } = await pool.query(
    `SELECT tournament_id, participant_id, wins
     FROM mv_tournament_leaderboard
     WHERE tournament_id = $1
     ORDER BY wins DESC`,
    [tournamentId]
  );
  return rows;
};

export const getMatchTrackScores = async (matchId: string) => {
  const { rows } = await pool.query(
    `SELECT match_track_id, avg_total
     FROM mv_match_track_scores
     WHERE match_id = $1`,
    [matchId]
  );
  return rows;
};
