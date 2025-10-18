import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
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

const relaxPluginVersion = <T>(plugin: T): T => {
  const meta = (plugin as unknown as Record<symbol, any>)[Symbol.for('plugin-meta')];
  if (meta && meta.fastify) {
    meta.fastify = '*';
  }
  return plugin;
};

export const buildApp = () => {
  const app = Fastify({
    logger: logger as any,
    trustProxy: true,
    disableRequestLogging: true,
  });

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

    const mapped = mapDbError(error);
    reply.status(mapped.status).send(formatProblemJson(mapped));
  });

  app.register(publicRoutes, { prefix: '/api/v1' });
  app.register(authRoutes, { prefix: '/api/v1/auth' });
  app.register(mediaRoutes, { prefix: '/api/v1/media' });
  app.register(artistRoutes, { prefix: '/api/v1' });
  app.register(moderatorRoutes, { prefix: '/api/v1/mod' });
  app.register(adminRoutes, { prefix: '/api/v1/admin' });
  app.register(judgeRoutes, { prefix: '/api/v1/judge' });

  app.get('/health', async () => ({ status: 'ok' }));

  return app;
};
