import { ensureRedis, redis } from '../lib/redis.js';
import { env } from '../config/env.js';
import { parseDurationSeconds } from '../lib/time.js';

const REFRESH_PREFIX = 'refresh:';

const refreshTtl = parseDurationSeconds(env.JWT_REFRESH_TTL);

export const storeRefreshToken = async (jti: string, userId: string) => {
  await ensureRedis();
  await redis.setex(REFRESH_PREFIX + jti, refreshTtl, userId);
};

export const revokeRefreshToken = async (jti: string) => {
  await ensureRedis();
  await redis.del(REFRESH_PREFIX + jti);
};

export const verifyRefreshToken = async (jti: string, userId: string) => {
  await ensureRedis();
  const stored = await redis.get(REFRESH_PREFIX + jti);
  return stored === userId;
};
