import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { setUserRole, getUserRoles, listUsersForAdmin } from '../services/users.js';
import { finalizeMatch, refreshPublicViews } from '../services/judging.js';
import { getProfileForViewer } from '../services/profile.js';
import { listAuditLog } from '../services/audit.js';
import { AppError } from '../lib/errors.js';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  const requireAdmin = fastify.requireRole(['admin']);

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
