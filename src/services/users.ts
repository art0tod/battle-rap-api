import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, tx } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';

export type UserRecord = {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: string;
  updated_at: string;
};

const BCRYPT_ROUNDS = 12;

export const createUser = async (params: { email: string; password: string; displayName: string }) => {
  const { email, password, displayName } = params;
  const hashed = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const client = await pool.connect();
  try {
    const user = await client.query<UserRecord>(
      `INSERT INTO app_user(id, email, password_hash, display_name)
       VALUES ($1,$2,$3,$4)
       RETURNING id, email, password_hash, display_name, created_at, updated_at`,
      [randomUUID(), email, hashed, displayName]
    );
    return user.rows[0];
  } catch (err) {
    throw mapDbError(err);
  } finally {
    client.release();
  }
};

export const findUserByEmail = async (email: string) => {
  const { rows } = await pool.query<UserRecord>(
    `SELECT id, email, password_hash, display_name, created_at, updated_at
     FROM app_user WHERE email_norm = lower($1) LIMIT 1`,
    [email]
  );
  return rows[0] ?? null;
};

export const getUserRoles = async (userId: string) => {
  const { rows } = await pool.query<{ role: string }>(
    `SELECT role FROM app_user_role WHERE user_id = $1`,
    [userId]
  );
  return rows.map((r: { role: string }) => r.role);
};

export const setUserRole = async (actorId: string, targetId: string, role: string, op: 'grant' | 'revoke') => {
  try {
    await pool.query('SELECT set_user_role($1,$2,$3,$4)', [actorId, targetId, role, op]);
  } catch (err) {
    throw mapDbError(err);
  }
};

export const grantDefaultListenerRole = async (userId: string) => {
  await tx(async (client) => {
    await client.query(
      `INSERT INTO app_user_role(user_id, role) VALUES ($1, 'listener')
       ON CONFLICT DO NOTHING`,
      [userId]
    );
  });
};
