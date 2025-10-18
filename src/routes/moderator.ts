import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import {
  listApplications,
  moderatorUpdateApplicationStatus,
  getApplicationById,
} from '../services/applications.js';
import {
  listProfileChangeRequests,
  moderatorResolveProfileChange,
  getProfileChangeRequestById,
} from '../services/profile.js';
import { publishSubmission, listSubmissionsForModeration, getSubmissionForModeration } from '../services/submissions.js';

const moderatorRoutes: FastifyPluginAsync = async (fastify) => {
  const requireModerator = fastify.requireRole(['moderator', 'admin']);

  fastify.get('/applications', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const query = z.object({
      status: z.string().optional(),
      limit: z.coerce.number().optional(),
    }).parse(request.query);
    return listApplications(query);
  });

  fastify.get('/applications/:id', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const application = await getApplicationById(params.id);
    if (!application) {
      throw new AppError({ status: 404, code: 'application_not_found', message: 'Application not found.' });
    }
    return application;
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

  fastify.get('/profile-changes/:id', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const change = await getProfileChangeRequestById(params.id);
    if (!change) {
      throw new AppError({ status: 404, code: 'profile_change_not_found', message: 'Profile change request not found.' });
    }
    return change;
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

  fastify.get('/submissions', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).optional(),
        limit: z.coerce.number().int().min(1).max(100).optional(),
        status: z.enum(['submitted', 'approved']).optional(),
        round_id: z.string().uuid().optional(),
        search: z.string().trim().optional(),
      })
      .parse(request.query);
    return listSubmissionsForModeration({
      page: query.page,
      limit: query.limit,
      status: query.status,
      roundId: query.round_id,
      search: query.search,
    });
  });

  fastify.get('/submissions/:id', { preHandler: [fastify.requireAuth, requireModerator] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const submission = await getSubmissionForModeration(params.id);
    if (!submission) {
      throw new AppError({ status: 404, code: 'submission_not_found', message: 'Submission not found.' });
    }
    return submission;
  });
};

export default moderatorRoutes;
