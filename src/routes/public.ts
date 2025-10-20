import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  listTournaments,
  getTournament,
  listRoundsForTournament,
  getRound,
  listMatchesForRound,
  getMatch,
  listMatchTracks,
  getLeaderboard,
  getMatchTrackScores,
  getRoundOverview,
  listPublicBattles,
} from '../services/tournaments.js';
import { resolveCdnUrl } from '../services/media.js';
import { AppError } from '../lib/errors.js';
import { listPublicParticipants } from '../services/participants.js';
import { TOURNAMENT_STATUSES } from '../lib/status.js';

const publicRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/tournaments', async (request) => {
    const querySchema = z.object({
      status: z.enum(TOURNAMENT_STATUSES).optional(),
      page: z.coerce.number().optional(),
      limit: z.coerce.number().optional(),
    });
    const params = querySchema.parse(request.query);
    return listTournaments(params);
  });

  fastify.get('/tournaments/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const tournament = await getTournament(params.id);
    if (!tournament) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Tournament not found.' });
    }
    const rounds = await listRoundsForTournament(params.id);
    return { tournament, rounds };
  });

  fastify.get('/rounds/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const round = await getRound(params.id);
    if (!round) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Round not found.' });
    }
    const matches = await listMatchesForRound(params.id);
    return { round, matches };
  });

  fastify.get('/rounds/:id/battles', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const round = await getRound(params.id);
    if (!round) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Round not found.' });
    }
    const matches = await listMatchesForRound(params.id);
    const now = Date.now();
    const judgingOpen =
      round.status === 'judging' || (round.status === 'finished' && (!round.judging_deadline_at || now > new Date(round.judging_deadline_at).getTime()));
    return {
      round,
      matches: matches.map((match): typeof match => ({
        ...match,
        winner_match_track_id: judgingOpen ? match.winner_match_track_id : null,
      })),
    };
  });

  fastify.get('/battles/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const match = await getMatch(params.id);
    if (!match) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Battle not found.' });
    }
    const now = Date.now();
    const canReveal = match.round_status === 'finished' || (match.judging_deadline_at && now > new Date(match.judging_deadline_at).getTime());

    return {
      id: match.id,
      round_id: match.round_id,
      starts_at: match.starts_at,
      status: match.status,
      ends_at: match.ends_at,
      winner_match_track_id: canReveal ? match.winner_match_track_id : null,
    };
  });

  fastify.get('/battles/:id/tracks', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const match = await getMatch(params.id);
    if (!match) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Battle not found.' });
    }
    const tracks = await listMatchTracks(params.id);
    const scores = await getMatchTrackScores(params.id);
    const scoreMap = new Map<string, number | null>(
      scores.map((s: { match_track_id: string; avg_total: number | null }) => [s.match_track_id, s.avg_total])
    );

    const now = Date.now();
    const canRevealScores = match.round_status === 'finished' || (match.judging_deadline_at && now > new Date(match.judging_deadline_at).getTime());

    return {
      match_id: match.id,
      tracks: tracks.map((track: {
        id: string;
        participant_id: string;
        storage_key: string;
        mime: string;
        duration_sec: number | null;
        submitted_at: string;
      }) => ({
        id: track.id,
        participant_id: track.participant_id,
        audio_url: resolveCdnUrl(track.storage_key),
        mime: track.mime,
        duration_sec: track.duration_sec,
        submitted_at: track.submitted_at,
        avg_total: canRevealScores ? scoreMap.get(track.id) ?? null : null,
      })),
    };
  });

  fastify.get('/rounds/:id/overview', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const overview = await getRoundOverview(params.id);
    if (!overview) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Round not found.' });
    }
    return overview;
  });

  fastify.get('/battles', async (request) => {
    const query = z
      .object({
        status: z.enum(['current', 'finished']).optional(),
        limit: z.coerce.number().int().min(1).max(50).optional(),
      })
      .parse(request.query);
    const battles = await listPublicBattles(query);
    return { battles };
  });

  fastify.get('/leaderboards', async (request) => {
    const query = z.object({ tournament: z.string().uuid() }).parse(request.query);
    const tournament = await getTournament(query.tournament);
    if (!tournament) {
      throw new AppError({ status: 404, code: 'not_found', message: 'Tournament not found.' });
    }
    const entries = await getLeaderboard(query.tournament);
    return {
      tournament_id: query.tournament,
      entries,
    };
  });

  fastify.get('/artists', async (request) => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      search: z
        .string()
        .trim()
        .min(1)
        .optional()
        .transform((val) => (val && val.length ? val : undefined)),
      role: z.enum(['artist', 'judge']).optional(),
      sort: z.enum(['joined_at', 'wins', 'rating']).optional(),
    });
    const query = querySchema.parse(request.query);
    return listPublicParticipants(query);
  });
};

export default publicRoutes;
