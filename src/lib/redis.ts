import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: true,
  maxRetriesPerRequest: 2,
});

export async function ensureRedis() {
  if (!redis.status || redis.status === 'close' || redis.status === 'end') {
    await redis.connect();
  }
}

export async function shutdownRedis() {
  if (redis.status !== 'end') {
    await redis.quit();
  }
}
