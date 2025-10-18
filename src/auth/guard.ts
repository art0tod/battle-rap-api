import fp from 'fastify-plugin';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyToken } from './jwt.js';
import { AppError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser?: {
      id: string;
      roles: string[];
      tokenType: 'access' | 'refresh';
      jti: string;
    };
  }
}

const parseAuthHeader = (header?: string) => {
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }
  return header.slice(7);
};

const authPlugin = fp(async (fastify: FastifyInstance) => {
  fastify.decorate('requireAuth', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.authUser) {
      throw new AppError({ status: 401, code: 'unauthorized', message: 'Authentication required.' });
    }
    if (request.authUser.tokenType !== 'access') {
      throw new AppError({ status: 401, code: 'invalid_token', message: 'Access token required.' });
    }
  });

  fastify.decorate(
    'requireRole',
    (roles: string[]) =>
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.authUser || request.authUser.tokenType !== 'access') {
          throw new AppError({ status: 401, code: 'unauthorized', message: 'Authentication required.' });
        }
        const hasRole = roles.some((role) => request.authUser?.roles.includes(role));
        if (!hasRole) {
          throw new AppError({ status: 403, code: 'forbidden', message: 'Insufficient permissions.' });
        }
      }
  );

  fastify.addHook('onRequest', async (request) => {
    const token = parseAuthHeader(request.headers.authorization);
    if (!token) return;
    try {
      const decoded = verifyToken(token);
      request.authUser = {
        id: decoded.sub as string,
        roles: Array.isArray(decoded.roles) ? decoded.roles : [],
        tokenType: decoded.type,
        jti: decoded.jti,
      };
    } catch (err) {
      request.log.debug({ err }, 'Failed to verify token');
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    requireRole(roles: string[]): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export default authPlugin;
