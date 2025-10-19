import { pool } from '../db/pool.js';
import { normalizePagination, buildPaginationClause } from '../lib/pagination.js';
import { normalizeUserRoles, roleOrderSqlLiteral } from '../lib/roles.js';
import { resolveCdnUrl } from './media.js';

export type PublicParticipantSort = 'joined_at' | 'wins' | 'rating';
export type PublicParticipantRoleFilter = 'artist' | 'judge';
export type PublicParticipantQuery = {
  page?: number;
  limit?: number;
  search?: string;
  role?: PublicParticipantRoleFilter;
  sort?: PublicParticipantSort;
};

type PublicParticipantRow = {
  id: string;
  display_name: string;
  created_at: string;
  city: string | null;
  full_name: string | null;
  avatar_key: string | null;
  roles: unknown;
  avg_total_score: string | null;
  total_wins: number | null;
};

const normalizeRoles = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return normalizeUserRoles(value);
  }
  try {
    if (typeof value === 'string') {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? normalizeUserRoles(parsed) : [];
    }
    if (typeof value === 'object' && value !== null && Symbol.iterator in (value as Record<string, unknown>)) {
      return normalizeUserRoles(value as Iterable<unknown>);
    }
  } catch {
    // ignore malformed json
  }
  return [];
};

const sortExpressions: Record<PublicParticipantSort, string> = {
  joined_at: 'b.created_at DESC',
  wins: 'stats.total_wins DESC, b.created_at DESC',
  rating: 'stats.avg_total_score DESC NULLS LAST, b.created_at DESC',
};

export const listPublicParticipants = async (params: PublicParticipantQuery) => {
  const pagination = normalizePagination(params.page, params.limit);
  const { limit, offset } = buildPaginationClause(pagination);
  const sortKey: PublicParticipantSort = params.sort ?? 'joined_at';
  const orderClause = sortExpressions[sortKey] ?? sortExpressions.joined_at;

  const filters: string[] = [];
  const values: Array<string | number> = [];

  if (params.search) {
    const token = `%${params.search.trim().replace(/\s+/g, '%')}%`;
    values.push(token);
    const placeholder = `$${values.length}`;
    filters.push(`(u.display_name ILIKE ${placeholder} OR COALESCE(ap.full_name, '') ILIKE ${placeholder})`);
  }

  if (params.role) {
    values.push(params.role);
    filters.push(`EXISTS (SELECT 1 FROM app_user_role aur WHERE aur.user_id = u.id AND aur.role = $${values.length})`);
  }

  filters.push(`EXISTS (SELECT 1 FROM app_user_role aur WHERE aur.user_id = u.id AND aur.role IN ('artist','judge'))`);
  const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const baseCte = `
    WITH base AS (
      SELECT
        u.id,
        u.display_name,
        u.created_at,
        ap.city,
        ap.full_name,
        ap.avatar_key,
        COALESCE(
          (
            SELECT json_agg(role ORDER BY array_position(${roleOrderSqlLiteral}, role))
            FROM (
              SELECT DISTINCT aur.role AS role
              FROM app_user_role aur
              WHERE aur.user_id = u.id AND aur.role IN ('artist','judge')
            ) ordered_roles
          ),
          '[]'::json
        ) AS roles
      FROM app_user u
      LEFT JOIN artist_profile ap ON ap.user_id = u.id
      ${whereClause}
    )
  `;

  const dataQuery = `
    ${baseCte}
    SELECT
      b.id,
      b.display_name,
      b.created_at,
      b.city,
      b.full_name,
      b.avatar_key,
      b.roles,
      stats.avg_total_score,
      stats.total_wins
    FROM base b
    LEFT JOIN LATERAL (
      SELECT
        (
          SELECT AVG(mv.avg_total)::numeric(6,2)
          FROM mv_match_track_scores mv
          JOIN match_track mt ON mt.id = mv.match_track_id
          JOIN match_participant mp ON mp.match_id = mt.match_id AND mp.participant_id = mt.participant_id
          JOIN tournament_participant tp ON tp.id = mp.participant_id
          WHERE tp.user_id = b.id
        ) AS avg_total_score,
        (
          SELECT COALESCE(SUM(lb.wins), 0)
          FROM mv_tournament_leaderboard lb
          JOIN tournament_participant tp2 ON tp2.id = lb.participant_id
          WHERE tp2.user_id = b.id
        ) AS total_wins
    ) stats ON TRUE
    ORDER BY ${orderClause}
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    ${baseCte}
    SELECT COUNT(*)::int AS total FROM base
  `;

  const dataValues = [...values, limit, offset];
  const [dataResult, countResult] = await Promise.all([
    pool.query<PublicParticipantRow>(dataQuery, dataValues),
    pool.query<{ total: number }>(countQuery, values),
  ]);

  const participants = dataResult.rows.map((row) => ({
    id: row.id,
    display_name: row.display_name,
    roles: normalizeRoles(row.roles),
    city: row.city,
    full_name: row.full_name,
    joined_at: row.created_at,
    avatar: row.avatar_key ? { key: row.avatar_key, url: resolveCdnUrl(row.avatar_key) } : null,
    avg_total_score: row.avg_total_score ? Number(row.avg_total_score) : null,
    total_wins: row.total_wins ?? 0,
  }));

  return {
    data: participants,
    page: pagination.page,
    limit: pagination.limit,
    total: countResult.rows[0]?.total ?? 0,
  };
};
