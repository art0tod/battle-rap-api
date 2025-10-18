import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import { logger, loggerOptions } from '../lib/logger.js';
import authPlugin from '../auth/guard.js';
import { AppError, formatProblemJson, handleZodError, mapDbError } from '../lib/errors.js';
import publicRoutes from '../routes/public.js';
import authRoutes from '../routes/auth.js';
import artistRoutes from '../routes/artist.js';
import moderatorRoutes from '../routes/moderator.js';
import adminRoutes from '../routes/admin.js';
import judgeRoutes from '../routes/judge.js';
import mediaRoutes from '../routes/media.js';
import { ZodError } from 'zod';
import profileRoutes from '../routes/profile.js';

const relaxPluginVersion = <T>(plugin: T): T => {
  const meta = (plugin as unknown as Record<symbol, any>)[Symbol.for('plugin-meta')];
  if (meta && meta.fastify) {
    meta.fastify = '*';
  }
  return plugin;
};

export const buildApp = () => {
  const app = Fastify({
    logger: { ...loggerOptions } as any,
    trustProxy: true,
    disableRequestLogging: true,
  });

  app.addHook('onRoute', (routeOptions) => {
    routeOptions.config = routeOptions.config ?? {};
  });

  app.addHook('onRequest', (request, _reply, done) => {
    const ctx = (request as any).context ?? { config: {} };
    ctx.config = ctx.config ?? request.routeOptions?.config ?? {};
    (request as any).context = ctx;
    done();
  });

  if (env.NODE_ENV !== 'test') {
    app.register(relaxPluginVersion(helmet), { contentSecurityPolicy: false });
    app.register(relaxPluginVersion(cors), {
      origin: true,
      credentials: true,
    });
    app.register(relaxPluginVersion(fastifyCookie));
    app.register(relaxPluginVersion(rateLimit), {
      max: 100,
      timeWindow: '1 minute',
    });
  }
  app.register(authPlugin);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      reply.status(error.status).send(formatProblemJson(error));
      return;
    }

    if (error instanceof ZodError) {
      const appError = handleZodError(error);
      reply.status(appError.status).send(formatProblemJson(appError));
      return;
    }

    // eslint-disable-next-line no-console
    console.error('unhandled', error);
    request.log.error({ err: error }, 'Unhandled error');
    const mapped = mapDbError(error);
    reply.status(mapped.status).send(formatProblemJson(mapped));
  });

  app.register(publicRoutes, { prefix: '/api/v1' });
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(mediaRoutes, { prefix: '/api/v1/media' });
  app.register(artistRoutes, { prefix: '/api/v1' });
  app.register(profileRoutes, { prefix: '/api/v1' });
  app.register(moderatorRoutes, { prefix: '/api/v1/mod' });
  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(judgeRoutes, { prefix: '/api/v1/judge' });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
