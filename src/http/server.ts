import { buildApp } from './app.js';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { shutdownRedis } from '../lib/redis.js';
import { closePool } from '../db/pool.js';

const app = buildApp();

const start = async () => {
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    logger.info({ port: env.PORT }, 'Server started');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

const shutdown = async () => {
  logger.info('Shutting down');
  await app.close();
  await closePool();
  await shutdownRedis();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
