import { randomUUID } from 'node:crypto';
import { pool, tx } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';
import { normalizePagination, buildPaginationClause } from '../lib/pagination.js';
import { resolveCdnUrl } from './media.js';

export type SubmissionInput = {
  roundId: string;
  participantId: string;
  audioId: string;
  lyrics?: string;
};

export const createOrUpdateSubmission = async (input: SubmissionInput, actorId: string) => {
  return tx(async (client) => {
    try {
      const { rows } = await client.query(
        `INSERT INTO submission(id, round_id, participant_id, audio_id, lyrics, status, submitted_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'draft',NULL, now())
         ON CONFLICT (round_id, participant_id) DO UPDATE
           SET audio_id = EXCLUDED.audio_id,
               lyrics = EXCLUDED.lyrics,
               updated_at = now()
         RETURNING id, status`,
        [randomUUID(), input.roundId, input.participantId, input.audioId, input.lyrics ?? null]
      );
      return rows[0];
    } catch (err) {
      throw mapDbError(err);
    }
  });
};

export const submitSubmission = async (submissionId: string, actorId: string) => {
  try {
    const { rowCount, rows } = await pool.query(
      `UPDATE submission
       SET status='submitted',
           submitted_at = COALESCE(submitted_at, now()),
           updated_at = now()
       WHERE id = $1
       RETURNING id, status`,
      [submissionId]
    );
    if (rowCount === 0) {
      throw new AppError({ status: 404, code: 'submission_not_found', message: 'Submission not found.' });
    }
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
};

export const publishSubmission = async (moderatorId: string, submissionId: string) => {
  try {
    await pool.query('SELECT publish_submission($1,$2)', [moderatorId, submissionId]);
  } catch (err) {
    throw mapDbError(err);
  }
};

export const findParticipantForRound = async (userId: string, roundId: string) => {
  const { rows } = await pool.query(
    `SELECT tp.id
     FROM tournament_participant tp
     JOIN round r ON r.tournament_id = tp.tournament_id
     WHERE tp.user_id = $1 AND r.id = $2
     LIMIT 1`,
    [userId, roundId]
  );
  return rows[0]?.id ?? null;
};

export const getSubmissionById = async (submissionId: string) => {
  const { rows } = await pool.query(
    `SELECT s.*, tp.user_id
     FROM submission s
     JOIN tournament_participant tp ON tp.id = s.participant_id
     WHERE s.id = $1`,
    [submissionId]
  );
  return rows[0] ?? null;
};

type ModerationSubmissionRow = {
  id: string;
  status: string;
  round_id: string;
  participant_id: string;
  submitted_at: string | null;
  updated_at: string;
  audio_id: string;
  lyrics: string | null;
  user_id: string;
  user_display_name: string;
  user_email: string;
  round_number: number;
  round_kind: string;
  tournament_id: string;
  tournament_title: string;
  audio_storage_key: string;
  audio_mime: string;
  audio_status: string;
};

export const listSubmissionsForModeration = async (params: {
  page?: number;
  limit?: number;
  status?: 'submitted' | 'approved';
  roundId?: string;
  search?: string;
}) => {
  const pagination = normalizePagination(params.page, params.limit);
  const { limit, offset } = buildPaginationClause(pagination);

  const statuses = params.status ? [params.status] : ['submitted', 'approved'];
  const filters: string[] = ['s.status = ANY($1::submission_status[])'];
  const values: unknown[] = [statuses];

  if (params.roundId) {
    values.push(params.roundId);
    filters.push(`s.round_id = $${values.length}`);
  }

  if (params.search) {
    const token = `%${params.search.trim().replace(/\s+/g, '%')}%`;
    values.push(token);
    filters.push(`(u.display_name ILIKE $${values.length} OR COALESCE(ap.full_name, '') ILIKE $${values.length})`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const baseQuery = `
    SELECT
      s.id,
      s.status,
      s.round_id,
      s.participant_id,
      s.submitted_at,
      s.updated_at,
      s.audio_id,
      s.lyrics,
      u.id AS user_id,
      u.display_name AS user_display_name,
      u.email AS user_email,
      r.number AS round_number,
      r.kind AS round_kind,
      t.id AS tournament_id,
      t.title AS tournament_title,
      ma.storage_key AS audio_storage_key,
      ma.mime AS audio_mime,
      ma.status AS audio_status
    FROM submission s
    JOIN round r ON r.id = s.round_id
    JOIN tournament t ON t.id = r.tournament_id
    JOIN tournament_participant tp ON tp.id = s.participant_id
    JOIN app_user u ON u.id = tp.user_id
    LEFT JOIN artist_profile ap ON ap.user_id = u.id
    LEFT JOIN media_asset ma ON ma.id = s.audio_id
    ${where}
    ORDER BY s.updated_at DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM submission s
    JOIN tournament_participant tp ON tp.id = s.participant_id
    JOIN app_user u ON u.id = tp.user_id
    LEFT JOIN artist_profile ap ON ap.user_id = u.id
    ${where}
  `;

  const [data, count] = await Promise.all([
    pool.query<ModerationSubmissionRow>(baseQuery, [...values, limit, offset]),
    pool.query<{ total: number }>(countQuery, values),
  ]);

  return {
    data: data.rows.map((row) => ({
      id: row.id,
      status: row.status,
      submitted_at: row.submitted_at,
      updated_at: row.updated_at,
      round: {
        id: row.round_id,
        number: row.round_number,
        kind: row.round_kind,
        tournament_id: row.tournament_id,
        tournament_title: row.tournament_title,
      },
      artist: {
        id: row.user_id,
        display_name: row.user_display_name,
        email: row.user_email,
      },
      audio: {
        id: row.audio_id,
        mime: row.audio_mime,
        status: row.audio_status,
        url: row.audio_storage_key ? resolveCdnUrl(row.audio_storage_key) : null,
      },
    })),
    page: pagination.page,
    limit: pagination.limit,
    total: count.rows[0]?.total ?? 0,
  };
};

export const getSubmissionForModeration = async (submissionId: string) => {
  const { rows } = await pool.query<ModerationSubmissionRow>(
    `SELECT
       s.id,
       s.status,
       s.round_id,
       s.participant_id,
       s.submitted_at,
       s.updated_at,
       s.audio_id,
       s.lyrics,
       u.id AS user_id,
       u.display_name AS user_display_name,
       u.email AS user_email,
       r.number AS round_number,
       r.kind AS round_kind,
       t.id AS tournament_id,
       t.title AS tournament_title,
       ma.storage_key AS audio_storage_key,
       ma.mime AS audio_mime,
       ma.status AS audio_status
     FROM submission s
     JOIN round r ON r.id = s.round_id
     JOIN tournament t ON t.id = r.tournament_id
     JOIN tournament_participant tp ON tp.id = s.participant_id
     JOIN app_user u ON u.id = tp.user_id
     LEFT JOIN media_asset ma ON ma.id = s.audio_id
     WHERE s.id = $1`,
    [submissionId]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    lyrics: row.lyrics,
    round: {
      id: row.round_id,
      number: row.round_number,
      kind: row.round_kind,
      tournament_id: row.tournament_id,
      tournament_title: row.tournament_title,
    },
    artist: {
      id: row.user_id,
      display_name: row.user_display_name,
      email: row.user_email,
    },
    audio: {
      id: row.audio_id,
      mime: row.audio_mime,
      status: row.audio_status,
      url: row.audio_storage_key ? resolveCdnUrl(row.audio_storage_key) : null,
    },
  };
};
