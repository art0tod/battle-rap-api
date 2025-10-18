import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { setUserRole, getUserRoles } from '../services/users.js';
import { finalizeMatch, refreshPublicViews } from '../services/judging.js';

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
};

export default adminRoutes;
