import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import {
  createOrUpdateSubmission,
  findParticipantForRound,
  getSubmissionById,
  submitSubmission,
} from '../services/submissions.js';
import { submitApplication, getApplicationForUser } from '../services/applications.js';
import { createProfileChangeRequest } from '../services/profile.js';

const artistRoutes: FastifyPluginAsync = async (fastify) => {
  const requireArtist = fastify.requireRole(['artist']);

  fastify.get('/applications/me', { preHandler: fastify.requireAuth }, async (request) => {
    const userId = request.authUser!.id;
    return getApplicationForUser(userId);
  });

  fastify.post('/applications', { preHandler: fastify.requireAuth }, async (request) => {
    const schema = z.object({
      city: z.string().optional(),
      age: z.number().int().min(12).max(120).optional(),
      vk_id: z.string().optional(),
      full_name: z.string().optional(),
      beat_author: z.string().optional(),
      audio_id: z.string().uuid().optional(),
      lyrics: z.string().optional(),
    });
    const body = schema.parse(request.body);
    const userId = request.authUser!.id;
    return submitApplication({
      userId,
      city: body.city,
      age: body.age,
      vkId: body.vk_id,
      fullName: body.full_name,
      beatAuthor: body.beat_author,
      audioId: body.audio_id,
      lyrics: body.lyrics,
    });
  });

  fastify.post('/profile/changes', { preHandler: fastify.requireAuth }, async (request) => {
    const schema = z.object({
      bio: z.string().max(2000).optional(),
      city: z.string().optional(),
      full_name: z.string().optional(),
      vk_id: z.string().optional(),
      avatar_key: z.string().optional(),
      age: z.number().int().min(12).max(120).optional(),
      socials: z.record(z.any()).optional(),
      display_name: z.string().optional(),
    });
    const body = schema.parse(request.body);
    const userId = request.authUser!.id;
    return createProfileChangeRequest(userId, body);
  });

  fastify.post('/rounds/:id/submissions', { preHandler: [fastify.requireAuth, requireArtist] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      audio_id: z.string().uuid(),
      lyrics: z.string().optional(),
    }).parse(request.body);
    const userId = request.authUser!.id;
    const participantId = await findParticipantForRound(userId, params.id);
    if (!participantId) {
      throw new AppError({ status: 403, code: 'participant_not_found', message: 'You are not registered for this round.' });
    }
    return createOrUpdateSubmission(
      {
        roundId: params.id,
        participantId,
        audioId: body.audio_id,
        lyrics: body.lyrics,
      },
      userId
    );
  });

  fastify.patch('/submissions/:id', { preHandler: [fastify.requireAuth, requireArtist] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({
      audio_id: z.string().uuid().optional(),
      lyrics: z.string().optional(),
    }).parse(request.body);
    const submission = await getSubmissionById(params.id);
    if (!submission || submission.user_id !== request.authUser!.id) {
      throw new AppError({ status: 404, code: 'submission_not_found', message: 'Submission not found.' });
    }
    return createOrUpdateSubmission(
      {
        roundId: submission.round_id,
        participantId: submission.participant_id,
        audioId: body.audio_id ?? submission.audio_id,
        lyrics: body.lyrics ?? submission.lyrics ?? undefined,
      },
      request.authUser!.id
    );
  });

  fastify.post('/submissions/:id/submit', { preHandler: [fastify.requireAuth, requireArtist] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const submission = await getSubmissionById(params.id);
    if (!submission || submission.user_id !== request.authUser!.id) {
      throw new AppError({ status: 404, code: 'submission_not_found', message: 'Submission not found.' });
    }
    await submitSubmission(params.id, request.authUser!.id);
    reply.status(204).send();
  });
};

export default artistRoutes;
