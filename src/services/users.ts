import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pool, tx } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';
import { normalizePagination, buildPaginationClause } from '../lib/pagination.js';
import { normalizeUserRoles, roleOrderSqlLiteral } from '../lib/roles.js';

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
    `SELECT role
     FROM app_user_role
     WHERE user_id = $1
     ORDER BY array_position(${roleOrderSqlLiteral}, role)`,
    [userId]
  );
  return normalizeUserRoles(rows.map((r: { role: string }) => r.role));
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

type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  roles: unknown;
  last_login_at: string | null;
};

const parseRoles = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return normalizeUserRoles(value);
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeUserRoles(parsed) : [];
    } catch {
      return [];
    }
  }
  if (typeof value === 'object' && value !== null && Symbol.iterator in (value as Record<string, unknown>)) {
    try {
      return normalizeUserRoles(value as Iterable<unknown>);
    } catch {
      return [];
    }
  }
  return [];
};

export const listUsersForAdmin = async (params: {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  sort?: 'created_at' | '-created_at' | 'display_name' | '-display_name';
}) => {
  const pagination = normalizePagination(params.page, params.limit);
  const { limit, offset } = buildPaginationClause(pagination);

  const sort = params.sort ?? '-created_at';
  const sortClause =
    sort === 'display_name' ? 'ORDER BY u.display_name ASC' :
    sort === '-display_name' ? 'ORDER BY u.display_name DESC' :
    sort === 'created_at' ? 'ORDER BY u.created_at ASC' :
    'ORDER BY u.created_at DESC';

  const filters: string[] = [];
  const values: unknown[] = [];

  if (params.search) {
    const token = `%${params.search.trim().replace(/\s+/g, '%')}%`;
    values.push(token);
    filters.push(`(u.display_name ILIKE $${values.length} OR u.email ILIKE $${values.length} OR ap.full_name ILIKE $${values.length})`);
  }

  if (params.role) {
    values.push(params.role);
    filters.push(`EXISTS (SELECT 1 FROM app_user_role aur WHERE aur.user_id = u.id AND aur.role = $${values.length})`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const baseQuery = `
    SELECT
      u.id,
      u.email,
      u.display_name,
      u.created_at,
      u.updated_at,
      COALESCE(
        (
          SELECT json_agg(role ORDER BY array_position(${roleOrderSqlLiteral}, role))
          FROM (
            SELECT DISTINCT aur.role AS role
            FROM app_user_role aur
            WHERE aur.user_id = u.id
          ) ordered_roles
        ),
        '[]'::json
      ) AS roles,
      NULL::TIMESTAMPTZ AS last_login_at
    FROM app_user u
    LEFT JOIN artist_profile ap ON ap.user_id = u.id
    ${where}
    ${sortClause}
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(DISTINCT u.id)::int AS total
    FROM app_user u
    LEFT JOIN artist_profile ap ON ap.user_id = u.id
    ${where}
  `;

  const [data, count] = await Promise.all([
    pool.query<AdminUserRow>(baseQuery, [...values, limit, offset]),
    pool.query<{ total: number }>(countQuery, values),
  ]);

  return {
    data: data.rows.map((row) => ({
      id: row.id,
      email: row.email,
      display_name: row.display_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
      roles: parseRoles(row.roles),
      last_login_at: row.last_login_at,
    })),
    page: pagination.page,
    limit: pagination.limit,
    total: count.rows[0]?.total ?? 0,
  };
};
