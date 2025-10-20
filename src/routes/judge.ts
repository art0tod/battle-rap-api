import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  assignNextBattleToJudge,
  getJudgeBattleDetails,
  getMatchRound,
  listJudgeAssignments,
  updateJudgeAssignmentStatus,
  upsertEvaluation,
} from '../services/judging.js';
import { AppError } from '../lib/errors.js';

const judgeRoutes: FastifyPluginAsync = async (fastify) => {
  const requireJudge = fastify.requireRole(['judge']);

  fastify.get('/assignments', { preHandler: [fastify.requireAuth, requireJudge] }, async (request) => {
    const judgeId = request.authUser!.id;
    return listJudgeAssignments(judgeId);
  });

  fastify.post('/assignments/random', { preHandler: [fastify.requireAuth, requireJudge] }, async (request, reply) => {
    const judgeId = request.authUser!.id;
    const assignment = await assignNextBattleToJudge(judgeId);
    if (!assignment) {
      reply.status(204).send();
      return;
    }
    reply.send(assignment);
  });

  fastify.post('/assignments/:id/status', { preHandler: [fastify.requireAuth, requireJudge] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['completed', 'skipped']),
      })
      .parse(request.body);
    return updateJudgeAssignmentStatus({
      assignmentId: params.id,
      judgeId: request.authUser!.id,
      status: body.status,
    });
  });

  fastify.get('/battles/:id', { preHandler: [fastify.requireAuth, requireJudge] }, async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const details = await getJudgeBattleDetails(request.authUser!.id, params.id);
    if (!details) {
      throw new AppError({ status: 404, code: 'battle_not_found', message: 'Battle not found.' });
    }
    return details;
  });

  fastify.post('/battles/:id/scores', { preHandler: [fastify.requireAuth, requireJudge] }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        rubric: z.record(z.number()).optional(),
        score: z.number().min(0).max(100).optional(),
        pass: z.boolean().optional(),
        comment: z.string().max(2000).optional(),
      })
      .refine((data) => data.rubric || data.score !== undefined || data.pass !== undefined, {
        message: 'At least one scoring field required',
      })
      .parse(request.body);

    const match = await getMatchRound(params.id);
    if (!match) {
      throw new AppError({ status: 404, code: 'battle_not_found', message: 'Battle not found.' });
    }
    await upsertEvaluation({
      judgeId: request.authUser!.id,
      matchId: params.id,
      roundId: match.round_id,
      pass: body.pass,
      score: body.score,
      rubric: body.rubric,
      comment: body.comment,
    });
    reply.status(201).send({ ok: true });
  });
};

export default judgeRoutes;
