import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { setUserRole, getUserRoles, listUsersForAdmin } from '../services/users.js';
import { finalizeMatch, refreshPublicViews } from '../services/judging.js';
import { getProfileForViewer } from '../services/profile.js';
import { listAuditLog } from '../services/audit.js';
import { AppError } from '../lib/errors.js';
import { MATCH_STATUSES } from '../lib/status.js';
import {
  createAdminBattle,
  deleteAdminBattle,
  getAdminBattle,
  listAdminBattles,
  updateAdminBattle,
} from '../services/battlesAdmin.js';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const requireAdmin = fastify.requireRole(['admin']);
  const matchStatusEnum = z.enum(MATCH_STATUSES);

  fastify.post('/roles/:userId', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request, reply) => {
    const params = z.object({ userId: z.string().uuid() }).parse(request.params);
    const body = z.object({
      op: z.enum(['grant', 'revoke']),
      role: z.enum(['artist', 'judge', 'listener', 'moderator', 'admin']),
    }).parse(request.body);
    await setUserRole(request.authUser!.id, params.userId, body.role, body.op);
    const roles = await getUserRoles(params.userId);
    reply.send({ user_id: params.userId, roles });
  });

  fastify.post('/finalize/battles/:id', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await finalizeMatch(params.id);
    await refreshPublicViews();
    reply.status(204).send();
  });

  fastify.get('/battles', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        status: matchStatusEnum.optional(),
        round_id: z.string().uuid().optional(),
        tournament_id: z.string().uuid().optional(),
      })
      .parse(request.query);
    return listAdminBattles(query);
  });

  fastify.post('/battles', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request, reply) => {
    const body = z
      .object({
        round_id: z.string().uuid(),
        starts_at: z.string().datetime().nullable().optional(),
        ends_at: z.string().datetime().nullable().optional(),
        status: matchStatusEnum.optional(),
        participants: z
          .array(
            z.object({
              participant_id: z.string().uuid(),
              seed: z.number().int().min(0).max(64).nullable().optional(),
            }),
          )
          .min(2),
      })
      .parse(request.body);

    const battle = await createAdminBattle(body);
    reply.status(201).send(battle);
  });

  fastify.get('/battles/:id', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const battle = await getAdminBattle(params.id);
    if (!battle) {
      throw new AppError({ status: 404, code: 'battle_not_found', message: 'Battle not found.' });
    }
    return battle;
  });

  fastify.patch('/battles/:id', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        round_id: z.string().uuid().optional(),
        starts_at: z.string().datetime().nullable().optional(),
        ends_at: z.string().datetime().nullable().optional(),
        status: matchStatusEnum.optional(),
        participants: z
          .array(
            z.object({
              participant_id: z.string().uuid(),
              seed: z.number().int().min(0).max(64).nullable().optional(),
            }),
          )
          .min(2)
          .optional(),
      })
      .parse(request.body);
    return updateAdminBattle(params.id, body);
  });

  fastify.delete('/battles/:id', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await deleteAdminBattle(params.id);
    reply.status(204).send();
  });

  fastify.get('/users', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        search: z.string().trim().optional(),
        role: z.enum(['admin', 'moderator', 'artist', 'judge', 'listener']).optional(),
        sort: z.enum(['created_at', '-created_at', 'display_name', '-display_name']).optional(),
      })
      .parse(request.query);
    return listUsersForAdmin(query);
  });

  fastify.get('/users/:id', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const profile = await getProfileForViewer({
      targetUserId: params.id,
      viewerId: request.authUser!.id,
      viewerRoles: request.authUser!.roles,
    });
    if (!profile) {
      throw new AppError({ status: 404, code: 'profile_not_found', message: 'Profile not found.' });
    }
    return profile;
  });

  fastify.get('/audit-log', { preHandler: [fastify.requireAuth, requireAdmin] }, async (request) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        actor_id: z.string().uuid().optional(),
        action: z.string().optional(),
        target_table: z.string().optional(),
        target_id: z.string().uuid().optional(),
      })
      .parse(request.query);
    return listAuditLog({
      page: query.page,
      limit: query.limit,
      actorId: query.actor_id,
      action: query.action,
      targetTable: query.target_table,
      targetId: query.target_id,
    });
  });
};

export default adminRoutes;
  const matchStatusEnum = z.enum(MATCH_STATUSES);
