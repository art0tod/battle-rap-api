import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';

export type ApplicationPayload = {
  userId: string;
  city?: string;
  age?: number;
  vkId?: string;
  fullName?: string;
  beatAuthor?: string;
  audioId?: string;
  lyrics?: string;
};

export const submitApplication = async (payload: ApplicationPayload) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO participation_application(id, user_id, round_id, status, city, age, vk_id, full_name, beat_author, audio_id, lyrics, created_at, updated_at)
       VALUES ($1,$2,NULL,'submitted',$3,$4,$5,$6,$7,$8,$9,now(),now())
       RETURNING id, status`,
      [
        randomUUID(),
        payload.userId,
        payload.city ?? null,
        payload.age ?? null,
        payload.vkId ?? null,
        payload.fullName ?? null,
        payload.beatAuthor ?? null,
        payload.audioId ?? null,
        payload.lyrics ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
};

export const getApplicationForUser = async (userId: string) => {
  const { rows } = await pool.query(
    `SELECT * FROM participation_application
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
};

export const listApplications = async (params: { status?: string; limit?: number }) => {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 20;
  const filters: string[] = [];
  const values: unknown[] = [];
  if (params.status) {
    filters.push(`status = $${values.length + 1}`);
    values.push(params.status);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, user_id, round_id, status, city, age, vk_id, full_name, audio_id, created_at
     FROM participation_application
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1}`,
    [...values, limit]
  );
  return rows;
};

export const moderatorUpdateApplicationStatus = async (params: {
  applicationId: string;
  moderatorId: string;
  status: 'approved' | 'rejected';
  rejectReason?: string;
}) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE participation_application
       SET status=$1,
           moderator_id=$2,
           reviewed_at=now(),
           reject_reason=$3,
           updated_at=now()
       WHERE id=$4`,
      [params.status, params.moderatorId, params.rejectReason ?? null, params.applicationId]
    );
    if (rowCount === 0) {
      throw new AppError({ status: 404, code: 'application_not_found', message: 'Application not found.' });
    }
  } catch (err) {
    throw mapDbError(err);
  }
};

export const getApplicationById = async (applicationId: string) => {
  const { rows } = await pool.query(
    `SELECT pa.*, u.display_name, u.email,
            ap.city AS profile_city, ap.full_name AS profile_full_name
     FROM participation_application pa
     JOIN app_user u ON u.id = pa.user_id
     LEFT JOIN artist_profile ap ON ap.user_id = pa.user_id
     WHERE pa.id = $1`,
    [applicationId]
  );
  return rows[0] ?? null;
};
