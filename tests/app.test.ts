import { describe, it, expect } from 'vitest';

const ensureTestEnv = () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/test';
  process.env.REDIS_URL ??= 'redis://localhost:6379';
  process.env.JWT_SECRET ??= 'secretsecretsecret';
  process.env.S3_ENDPOINT ??= 'http://localhost:9000';
  process.env.S3_BUCKET ??= 'test';
  process.env.S3_ACCESS_KEY ??= 'key';
  process.env.S3_SECRET_KEY ??= 'secret';
  process.env.S3_REGION ??= 'us-east-1';
  process.env.CDN_BASE_URL ??= 'http://localhost:9000';
  process.env.JWT_ACCESS_TTL ??= '900s';
  process.env.JWT_REFRESH_TTL ??= '30d';
  process.env.NODE_ENV ??= 'test';
};

describe('App bootstrap', () => {
  it('responds to health check', async () => {
    ensureTestEnv();
    const { buildApp } = await import('../src/http/app.js');
    const app = buildApp();
    await app.ready();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
