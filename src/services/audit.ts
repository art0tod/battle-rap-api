import { pool } from '../db/pool.js';
import { normalizePagination, buildPaginationClause } from '../lib/pagination.js';

export type AuditLogQuery = {
  page?: number;
  limit?: number;
  actorId?: string;
  action?: string;
  targetTable?: string;
  targetId?: string;
};

type AuditRow = {
  id: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action: string;
  target_table: string;
  target_id: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
};

export const listAuditLog = async (params: AuditLogQuery) => {
  const pagination = normalizePagination(params.page, params.limit);
  const { limit, offset } = buildPaginationClause(pagination);

  const filters: string[] = [];
  const values: unknown[] = [];

  if (params.actorId) {
    values.push(params.actorId);
    filters.push(`al.actor_user_id = $${values.length}`);
  }
  if (params.action) {
    values.push(params.action);
    filters.push(`al.action = $${values.length}`);
  }
  if (params.targetTable) {
    values.push(params.targetTable);
    filters.push(`al.target_table = $${values.length}`);
  }
  if (params.targetId) {
    values.push(params.targetId);
    filters.push(`al.target_id = $${values.length}`);
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

  const dataQuery = `
    SELECT
      al.id,
      al.actor_user_id,
      u.display_name AS actor_display_name,
      al.action,
      al.target_table,
      al.target_id,
      al.payload,
      al.created_at
    FROM audit_log al
    LEFT JOIN app_user u ON u.id = al.actor_user_id
    ${where}
    ORDER BY al.created_at DESC
    LIMIT $${values.length + 1}
    OFFSET $${values.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM audit_log al
    ${where}
  `;

  const [data, count] = await Promise.all([
    pool.query<AuditRow>(dataQuery, [...values, limit, offset]),
    pool.query<{ total: number }>(countQuery, values),
  ]);

  return {
    data: data.rows.map((row) => ({
      id: row.id,
      actor_user_id: row.actor_user_id,
      actor_display_name: row.actor_display_name,
      action: row.action,
      target_table: row.target_table,
      target_id: row.target_id,
      payload: row.payload ?? {},
      created_at: row.created_at,
    })),
    page: pagination.page,
    limit: pagination.limit,
    total: count.rows[0]?.total ?? 0,
  };
};
