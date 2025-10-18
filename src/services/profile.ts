import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { AppError, mapDbError } from '../lib/errors.js';
import { resolveCdnUrl } from './media.js';

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

type ProfileRow = {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
  avatar_key: string | null;
  bio: string | null;
  socials: Record<string, unknown> | null;
  city: string | null;
  age: number | null;
  vk_id: string | null;
  full_name: string | null;
  roles: unknown;
};

export type ProfileView = {
  id: string;
  display_name: string;
  roles: string[];
  avatar: { key: string; url: string } | null;
  bio: string | null;
  city: string | null;
  created_at: string;
  updated_at: string;
  viewer_context: {
    is_self: boolean;
    can_edit: boolean;
    can_moderate: boolean;
    can_view_private: boolean;
  };
  email?: string;
  age?: number | null;
  vk_id?: string | null;
  full_name?: string | null;
  socials?: Record<string, unknown>;
};

const fetchProfileRow = async (userId: string) => {
  const { rows } = await pool.query<ProfileRow>(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.created_at,
       u.updated_at,
       ap.avatar_key,
       ap.bio,
       ap.socials,
       ap.city,
       ap.age,
       ap.vk_id,
       ap.full_name,
       COALESCE(
         (
           SELECT json_agg(role ORDER BY role)
           FROM app_user_role aur
           WHERE aur.user_id = u.id
         ),
         '[]'::json
       ) AS roles
     FROM app_user u
     LEFT JOIN artist_profile ap ON ap.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] ?? null;
};

const normalizeRoles = (value: unknown): string[] => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((role): role is string => typeof role === 'string');
  }
  if (typeof value === 'string') {
    return value
      .replace(/^\{|\}$/g, '')
      .split(',')
      .map((role) => role.replace(/"/g, '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'object' && value !== null && 'length' in value && typeof (value as any).map === 'function') {
    try {
      return Array.from(value as unknown as Iterable<unknown>).filter((role): role is string => typeof role === 'string');
    } catch {
      return [];
    }
  }
  return [];
};

const toProfileView = (row: ProfileRow, viewer: { id: string | null; roles: string[] }): ProfileView => {
  const isSelf = viewer.id != null && viewer.id === row.id;
  const viewerRoles = new Set(viewer.roles);
  const isModerator = viewerRoles.has('admin') || viewerRoles.has('moderator');
  const canViewPrivate = isSelf || isModerator;

  const roles = normalizeRoles(row.roles);
  const publicRoles = roles.filter((role) => role !== 'listener');
  const exposedRoles = canViewPrivate || publicRoles.length === 0 ? roles : publicRoles;

  const base: ProfileView = {
    id: row.id,
    display_name: row.display_name,
    roles: exposedRoles,
    avatar: row.avatar_key ? { key: row.avatar_key, url: resolveCdnUrl(row.avatar_key) } : null,
    bio: row.bio,
    city: row.city,
    created_at: row.created_at,
    updated_at: row.updated_at,
    viewer_context: {
      is_self: isSelf,
      can_edit: isSelf,
      can_moderate: isModerator,
      can_view_private: canViewPrivate,
    },
  };

  if (canViewPrivate) {
    base.email = row.email;
    base.age = row.age;
    base.vk_id = row.vk_id;
    base.full_name = row.full_name;
    base.socials = row.socials ?? undefined;
  }

  return base;
};

export const getProfileForViewer = async (params: { targetUserId: string; viewerId?: string | null; viewerRoles?: string[] }) => {
  const row = await fetchProfileRow(params.targetUserId);
  if (!row) {
    return null;
  }
  return toProfileView(row, { id: params.viewerId ?? null, roles: params.viewerRoles ?? [] });
};

export const getOwnProfile = async (userId: string, roles: string[]) => {
  const row = await fetchProfileRow(userId);
  if (!row) {
    throw new AppError({ status: 404, code: 'profile_not_found', message: 'Profile not found.' });
  }
  return toProfileView(row, { id: userId, roles });
};

export const getProfileChangeRequestById = async (requestId: string) => {
  const { rows } = await pool.query(
    `SELECT pcr.id,
            pcr.user_id,
            pcr.changes,
            pcr.status,
            pcr.moderator_id,
            pcr.reject_reason,
            pcr.created_at,
            pcr.updated_at,
            pcr.reviewed_at,
            u.display_name,
            u.email
     FROM profile_change_request pcr
     JOIN app_user u ON u.id = pcr.user_id
     WHERE pcr.id = $1`,
    [requestId]
  );
  return rows[0] ?? null;
};
