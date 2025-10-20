import { pool } from '../db/pool.js';
import { normalizePagination, buildPaginationClause } from '../lib/pagination.js';
import { resolveCdnUrl } from './media.js';
import type { TournamentStatus } from '../lib/status.js';

export const listTournaments = async (params: { status?: TournamentStatus; page?: number; limit?: number }) => {
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

export const getRoundOverview = async (roundId: string) => {
  const round = await getRound(roundId);
  if (!round) {
    return null;
  }

  if (round.scoring === 'pass_fail' || round.scoring === 'points') {
    const { rows: submissionRows } = await pool.query(
      `SELECT
          s.id AS submission_id,
          tp.id AS participant_id,
          tp.user_id,
          u.display_name,
          ap.avatar_key,
          s.status,
          s.lyrics,
          s.submitted_at,
          ma.storage_key,
          ma.mime,
          ma.duration_sec,
          COUNT(e.*) FILTER (WHERE e.pass IS TRUE) AS pass_count,
          COUNT(e.*) FILTER (WHERE e.pass IS FALSE) AS fail_count,
          COUNT(e.*) FILTER (WHERE e.score IS NOT NULL) AS judge_count,
          COALESCE(SUM(e.score), 0) AS total_score,
          AVG(e.score) AS avg_score,
          COUNT(e.*) AS total_reviews
       FROM submission s
       JOIN tournament_participant tp ON tp.id = s.participant_id
       JOIN app_user u ON u.id = tp.user_id
       LEFT JOIN artist_profile ap ON ap.user_id = tp.user_id
       JOIN media_asset ma ON ma.id = s.audio_id
       LEFT JOIN evaluation e ON e.target_type = 'submission' AND e.target_id = s.id
       WHERE s.round_id = $1
       GROUP BY s.id, tp.id, tp.user_id, u.display_name, ap.avatar_key, s.status, s.lyrics, s.submitted_at, ma.storage_key, ma.mime, ma.duration_sec
       ORDER BY
         (COUNT(e.*) FILTER (WHERE e.pass IS TRUE)) DESC,
         COUNT(e.*) DESC,
         u.display_name`,
      [roundId]
    );

    const submissions = submissionRows.map((row) => ({
      submission_id: row.submission_id,
      participant_id: row.participant_id,
      user_id: row.user_id,
      display_name: row.display_name,
      status: row.status,
      submitted_at: row.submitted_at,
       lyrics: row.lyrics ?? null,
      pass_count: Number(row.pass_count ?? 0),
      fail_count: Number(row.fail_count ?? 0),
      judge_count: Number(row.judge_count ?? 0),
      total_score: Number(row.total_score ?? 0),
      avg_score: row.avg_score !== null && row.avg_score !== undefined ? Number(row.avg_score) : null,
      total_reviews: Number(row.total_reviews ?? 0),
      audio: {
        key: row.storage_key,
        url: resolveCdnUrl(row.storage_key),
        mime: row.mime,
        duration_sec: row.duration_sec !== null && row.duration_sec !== undefined ? Number(row.duration_sec) : null,
      },
      avatar: row.avatar_key ? { key: row.avatar_key, url: resolveCdnUrl(row.avatar_key) } : null,
    }));

    const summary = {
      total_submissions: submissions.length,
      total_reviews: submissions.reduce((acc, item) => acc + (item.total_reviews ?? 0), 0),
      mode: round.scoring,
    };

    return {
      round,
      mode: round.scoring,
      submissions,
      summary,
    };
  }

  const { rows: matchRows } = await pool.query(
    `SELECT
        m.id,
        m.status,
        m.starts_at,
        m.ends_at,
        m.winner_match_track_id
     FROM match m
     WHERE m.round_id = $1
     ORDER BY m.starts_at NULLS FIRST, m.id`,
    [roundId]
  );

  const matchIds = matchRows.map((row) => row.id);
  let participantRows: Array<{
    match_id: string;
    participant_id: string;
    seed: number | null;
    user_id: string;
    display_name: string;
    city: string | null;
    age: number | null;
    avatar_key: string | null;
    track_id: string | null;
    submitted_at: string | null;
    lyrics: string | null;
    storage_key: string | null;
    mime: string | null;
    duration_sec: number | null;
    avg_total: number | null;
    likes: number | null;
  }> = [];

  if (matchIds.length > 0) {
    const { rows } = await pool.query<{
      match_id: string;
      participant_id: string;
      seed: number | null;
      user_id: string;
      display_name: string;
      city: string | null;
      age: number | null;
      avatar_key: string | null;
      track_id: string | null;
      submitted_at: string | null;
      lyrics: string | null;
      storage_key: string | null;
      mime: string | null;
      duration_sec: number | null;
      avg_total: number | null;
      likes: number | null;
    }>(
      `SELECT
          mp.match_id,
          mp.participant_id,
          mp.seed,
          tp.user_id,
          u.display_name,
          mt.id AS track_id,
          mt.submitted_at,
          mt.lyrics,
          ma.storage_key,
          ma.mime,
          ma.duration_sec,
          scores.avg_total
       FROM match_participant mp
       JOIN tournament_participant tp ON tp.id = mp.participant_id
       JOIN app_user u ON u.id = tp.user_id
       LEFT JOIN match_track mt ON mt.match_id = mp.match_id AND mt.participant_id = mp.participant_id
       LEFT JOIN media_asset ma ON ma.id = mt.audio_id
       LEFT JOIN mv_match_track_scores scores ON scores.match_track_id = mt.id
       WHERE mp.match_id = ANY($1::uuid[])
       ORDER BY mp.match_id, mp.seed NULLS LAST, u.display_name`,
      [matchIds]
    );
    participantRows = rows;
  }

  const matches = matchRows.map((match) => ({
    id: match.id,
    status: match.status,
    starts_at: match.starts_at,
    ends_at: match.ends_at,
    winner_match_track_id: match.winner_match_track_id,
    participants: participantRows
      .filter((row) => row.match_id === match.id)
      .map((row) => ({
        participant_id: row.participant_id,
        user_id: row.user_id,
        display_name: row.display_name,
        seed: row.seed,
        avg_total_score: row.avg_total !== null && row.avg_total !== undefined ? Number(row.avg_total) : null,
        track: row.track_id
          ? {
              id: row.track_id,
              audio_key: row.storage_key,
              audio_url: row.storage_key ? resolveCdnUrl(row.storage_key) : null,
              mime: row.mime,
              duration_sec: row.duration_sec !== null && row.duration_sec !== undefined ? Number(row.duration_sec) : null,
              submitted_at: row.submitted_at,
              lyrics: row.lyrics ?? null,
            }
          : null,
      })),
  }));

  const { rows: rubricRows } = await pool.query(
    `SELECT
        key,
        name,
        weight,
        min_value,
        max_value,
        position
     FROM round_rubric_criterion
     WHERE round_id = $1
     ORDER BY position NULLS LAST, name`,
    [roundId]
  );

  const { rows: totalReviewRows } = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM evaluation
     WHERE round_id = $1 AND target_type = 'match'`,
    [roundId]
  );

  const summary = {
    total_matches: matches.length,
    total_tracks: participantRows.filter((row) => row.track_id).length,
    total_reviews: Number(totalReviewRows[0]?.total ?? 0),
    mode: round.scoring,
  };

  return {
    round,
    mode: round.scoring,
    matches,
    rubric: rubricRows,
    summary,
  };
};

type PublicBattleStatusFilter = 'current' | 'finished';

export const listPublicBattles = async (params: { status?: PublicBattleStatusFilter; limit?: number }) => {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 20;
  const filters: string[] = [];

  if (params.status === 'finished') {
    filters.push(`m.status IN ('finished','tie')`);
  } else if (params.status === 'current') {
    filters.push(`m.status NOT IN ('finished','tie')`);
  }

  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const { rows: matchRows } = await pool.query<{
    id: string;
    status: string;
    starts_at: string | null;
    ends_at: string | null;
    winner_match_track_id: string | null;
    round_id: string;
    round_number: number;
    round_kind: string;
    round_status: string;
    round_scoring: string;
    round_strategy: string;
    judging_deadline_at: string | null;
    tournament_id: string;
    tournament_title: string;
  }>(
    `SELECT
        m.id,
        m.status,
        m.starts_at,
        m.ends_at,
        m.winner_match_track_id,
        r.id AS round_id,
        r.number AS round_number,
        r.kind AS round_kind,
        r.status AS round_status,
        r.scoring AS round_scoring,
        r.strategy AS round_strategy,
        r.judging_deadline_at,
        t.id AS tournament_id,
        t.title AS tournament_title
     FROM match m
     JOIN round r ON r.id = m.round_id
     JOIN tournament t ON t.id = r.tournament_id
     ${whereClause}
     ORDER BY
       CASE WHEN m.starts_at IS NULL THEN 1 ELSE 0 END,
       m.starts_at DESC NULLS LAST,
       m.id
     LIMIT $1`,
    [limit]
  );

  const battleIds = matchRows.map((row) => row.id);
  let participantRows: Array<{
    match_id: string;
    participant_id: string;
    seed: number | null;
    user_id: string;
    display_name: string;
    city: string | null;
    age: number | null;
    avatar_key: string | null;
    track_id: string | null;
    submitted_at: string | null;
    lyrics: string | null;
    storage_key: string | null;
    mime: string | null;
    duration_sec: number | null;
    avg_total: number | null;
    likes: number | null;
  }> = [];

  if (battleIds.length > 0) {
    const { rows } = await pool.query<{
      match_id: string;
      participant_id: string;
      seed: number | null;
      user_id: string;
      display_name: string;
      city: string | null;
      age: number | null;
      avatar_key: string | null;
      track_id: string | null;
      submitted_at: string | null;
      lyrics: string | null;
      storage_key: string | null;
      mime: string | null;
      duration_sec: number | null;
      avg_total: number | null;
      likes: number | null;
    }>(
      `SELECT
          mp.match_id,
          mp.participant_id,
          mp.seed,
          tp.user_id,
          u.display_name,
          ap.city,
          ap.age,
          ap.avatar_key,
          mt.id AS track_id,
          mt.submitted_at,
          mt.lyrics,
          ma.storage_key,
          ma.mime,
          ma.duration_sec,
          scores.avg_total,
          COALESCE(likes.total_likes, 0)::int AS likes
       FROM match_participant mp
       JOIN tournament_participant tp ON tp.id = mp.participant_id
       JOIN app_user u ON u.id = tp.user_id
       LEFT JOIN artist_profile ap ON ap.user_id = tp.user_id
       LEFT JOIN match_track mt ON mt.match_id = mp.match_id AND mt.participant_id = mp.participant_id
       LEFT JOIN media_asset ma ON ma.id = mt.audio_id
       LEFT JOIN mv_match_track_scores scores ON scores.match_track_id = mt.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS total_likes
         FROM track_like tl
         WHERE tl.match_track_id = mt.id
       ) likes ON TRUE
       WHERE mp.match_id = ANY($1::uuid[])
       ORDER BY mp.match_id, mp.seed NULLS LAST, u.display_name`,
      [battleIds]
    );
    participantRows = rows;
  }

  return matchRows.map((match) => {
    const isFinished = match.status === 'finished' || match.status === 'tie';
    return {
      id: match.id,
      status: match.status,
      starts_at: match.starts_at,
      ends_at: match.ends_at,
      winner_match_track_id: isFinished ? match.winner_match_track_id : null,
      round: {
        id: match.round_id,
        number: match.round_number,
        kind: match.round_kind,
        status: match.round_status,
        scoring: match.round_scoring,
        strategy: match.round_strategy,
        judging_deadline_at: match.judging_deadline_at,
      },
      tournament: {
        id: match.tournament_id,
        title: match.tournament_title,
      },
      participants: participantRows
        .filter((row) => row.match_id === match.id)
        .map((row) => ({
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
          avg_total_score: row.avg_total !== null && row.avg_total !== undefined ? Number(row.avg_total) : null,
          track: row.track_id
            ? {
                id: row.track_id,
                audio_key: row.storage_key,
                audio_url: row.storage_key ? resolveCdnUrl(row.storage_key) : null,
                mime: row.mime,
                duration_sec: row.duration_sec !== null && row.duration_sec !== undefined ? Number(row.duration_sec) : null,
                submitted_at: row.submitted_at,
                lyrics: row.lyrics ?? null,
                likes: row.likes ?? 0,
              }
            : null,
        })),
    };
  });
};
