import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { createUser, findUserByEmail, getUserRoles, grantDefaultListenerRole } from '../services/users.js';
import { AppError } from '../lib/errors.js';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt.js';
import { parseDurationSeconds } from '../lib/time.js';
import { env } from '../config/env.js';
import { storeRefreshToken, revokeRefreshToken, verifyRefreshToken } from '../services/tokens.js';
import { getOwnProfile } from '../services/profile.js';

const authRoutes: FastifyPluginAsync = async (fastify) => {
  const refreshMaxAge = parseDurationSeconds(env.JWT_REFRESH_TTL);

  const RegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    display_name: z.string().min(2),
  });

  fastify.post('/register', async (request, reply) => {
    const payload = RegisterSchema.parse(request.body);
    const user = await createUser({
      email: payload.email,
      password: payload.password,
      displayName: payload.display_name,
    });
    await grantDefaultListenerRole(user.id);
    const roles = await getUserRoles(user.id);

    const accessToken = signAccessToken(user.id, roles);
    const refresh = signRefreshToken(user.id, roles);
    await storeRefreshToken(refresh.jti, user.id);

    reply.setCookie('refresh_token', refresh.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: refreshMaxAge,
      secure: env.NODE_ENV === 'production',
    });

    reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: parseDurationSeconds(env.JWT_ACCESS_TTL),
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        roles,
      },
    });
  });

  const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });

  fastify.post('/login', async (request, reply) => {
    const payload = LoginSchema.parse(request.body);
    const user = await findUserByEmail(payload.email);
    if (!user) {
      throw new AppError({ status: 401, code: 'invalid_credentials', message: 'Invalid email or password.' });
    }
    const ok = await bcrypt.compare(payload.password, user.password_hash);
    if (!ok) {
      throw new AppError({ status: 401, code: 'invalid_credentials', message: 'Invalid email or password.' });
    }
    const roles = await getUserRoles(user.id);
    const accessToken = signAccessToken(user.id, roles);
    const refresh = signRefreshToken(user.id, roles);
    await storeRefreshToken(refresh.jti, user.id);

    reply.setCookie('refresh_token', refresh.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: refreshMaxAge,
      secure: env.NODE_ENV === 'production',
    });

    reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: parseDurationSeconds(env.JWT_ACCESS_TTL),
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        roles,
      },
    });
  });

  fastify.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies.refresh_token;
    if (!refreshToken) {
      throw new AppError({ status: 401, code: 'invalid_token', message: 'Refresh token missing.' });
    }
    const payload = verifyToken(refreshToken);
    if (payload.type !== 'refresh') {
      throw new AppError({ status: 401, code: 'invalid_token', message: 'Refresh token invalid.' });
    }
    const isValid = await verifyRefreshToken(payload.jti, payload.sub as string);
    if (!isValid) {
      throw new AppError({ status: 401, code: 'invalid_token', message: 'Refresh token expired.' });
    }
    await revokeRefreshToken(payload.jti);
    const roles = await getUserRoles(payload.sub as string);
    const accessToken = signAccessToken(payload.sub as string, roles);
    const refreshed = signRefreshToken(payload.sub as string, roles);
    await storeRefreshToken(refreshed.jti, payload.sub as string);
    reply.setCookie('refresh_token', refreshed.token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: refreshMaxAge,
      secure: env.NODE_ENV === 'production',
    });
    reply.send({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: parseDurationSeconds(env.JWT_ACCESS_TTL),
    });
  });

  fastify.post('/logout', async (request, reply) => {
    const refreshToken = request.cookies.refresh_token;
    if (refreshToken) {
      try {
        const payload = verifyToken(refreshToken);
        if (payload.type === 'refresh') {
          await revokeRefreshToken(payload.jti);
        }
      } catch {
        // ignore
      }
    }
    reply.clearCookie('refresh_token', { path: '/api/v1/auth' });
    reply.status(204).send();
  });

  fastify.get('/me', { preHandler: fastify.requireAuth }, async (request) => {
    const user = request.authUser!;
    return getOwnProfile(user.id, user.roles);
  });
};

export default authRoutes;
