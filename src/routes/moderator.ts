import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import {
  listApplications,
  moderatorUpdateApplicationStatus,
} from '../services/applications.js';
import {
  listProfileChangeRequests,
  moderatorResolveProfileChange,
} from '../services/profile.js';
import { publishSubmission } from '../services/submissions.js';

const moderatorRoutes: FastifyPluginAsync = async (fastify) => {
  const requireModerator = fastify.requireRole(['moderator', 'admin']);

  fastify.get('/applications', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const query = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query);
    return listApplications(query);
  });

  fastify.post('/applications/:id/approve', { preHandler: [fastify.requireAuth, requireModerator] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await moderatorUpdateApplicationStatus({
      applicationId: params.id,
      moderatorId: request.authUser!.id,
      status: 'approved',
    });
    reply.status(204).send();
  });

  fastify.post('/applications/:id/reject', { preHandler: [fastify.requireAuth, requireModerator] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1) }).parse(request.body);
    await moderatorUpdateApplicationStatus({
      applicationId: params.id,
      moderatorId: request.authUser!.id,
      status: 'rejected',
      rejectReason: body.reason,
    });
    reply.status(204).send();
  });

  fastify.get('/profile-changes', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const query = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query);
    return listProfileChangeRequests(query);
  });

  fastify.post('/profile-changes/:id/approve', { preHandler: [fastify.requireAuth, requireModerator] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await moderatorResolveProfileChange({
      requestId: params.id,
      moderatorId: request.authUser!.id,
      status: 'approved',
    });
    reply.status(204).send();
  });

  fastify.post('/profile-changes/:id/reject', { preHandler: [fastify.requireAuth, requireModerator] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1) }).parse(request.body);
    await moderatorResolveProfileChange({
      requestId: params.id,
      moderatorId: request.authUser!.id,
      status: 'rejected',
      rejectReason: body.reason,
    });
    reply.status(204).send();
  });

  fastify.post('/submissions/:id/publish', { preHandler: [fastify.requireAuth, requireModerator] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    await publishSubmission(request.authUser!.id, params.id);
    reply.status(204).send();
  });
};

export default moderatorRoutes;
