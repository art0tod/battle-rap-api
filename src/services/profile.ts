import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';

export type ProfileChangePayload = {
  bio?: string;
  city?: string;
  full_name?: string;
  vk_id?: string;
  avatar_key?: string;
  age?: number;
  socials?: Record<string, unknown>;
  display_name?: string;
};

export const createProfileChangeRequest = async (userId: string, changes: ProfileChangePayload) => {
  try {
    const { rows } = await pool.query(
      `INSERT INTO profile_change_request(id, user_id, changes, created_at, updated_at)
       VALUES ($1,$2,$3::jsonb,now(),now())
       RETURNING id, status`,
      [randomUUID(), userId, JSON.stringify(changes)]
    );
    return rows[0];
  } catch (err) {
    throw mapDbError(err);
  }
};

export const listProfileChangeRequests = async (params: { status?: string; limit?: number }) => {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 50) : 20;
  const filters: string[] = [];
  const values: unknown[] = [];
  if (params.status) {
    filters.push(`status = $${values.length + 1}`);
    values.push(params.status);
  }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT id, user_id, changes, status, created_at
     FROM profile_change_request
     ${where}
     ORDER BY created_at DESC
     LIMIT $${values.length + 1}`,
    [...values, limit]
  );
  return rows;
};

export const moderatorResolveProfileChange = async (params: {
  requestId: string;
  moderatorId: string;
  status: 'approved' | 'rejected';
  rejectReason?: string;
}) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE profile_change_request
       SET status=$1,
           moderator_id=$2,
           reviewed_at=now(),
           reject_reason=$3,
           updated_at=now()
       WHERE id=$4`,
      [params.status, params.moderatorId, params.rejectReason ?? null, params.requestId]
    );
    if (rowCount === 0) {
      throw new AppError({ status: 404, code: 'profile_change_not_found', message: 'Profile change request not found.' });
    }
  } catch (err) {
    throw mapDbError(err);
  }
};
