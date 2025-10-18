import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { getOwnProfile, getProfileForViewer } from '../services/profile.js';
import { AppError } from '../lib/errors.js';

const profileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/profile/me', { preHandler: fastify.requireAuth }, async (request) => {
    const user = request.authUser!;
    return getOwnProfile(user.id, user.roles);
  });

  fastify.get('/profile/:id', async (request) => {
    const params = z.object({ id: z.string().uuid() }).parse(request.params);
    const authUser = request.authUser && request.authUser.tokenType === 'access' ? request.authUser : undefined;
    const profile = await getProfileForViewer({
      targetUserId: params.id,
      viewerId: authUser?.id ?? null,
      viewerRoles: authUser?.roles ?? [],
    });
    if (!profile) {
      throw new AppError({ status: 404, code: 'profile_not_found', message: 'Profile not found.' });
    }
    return profile;
  });
};

export default profileRoutes;
