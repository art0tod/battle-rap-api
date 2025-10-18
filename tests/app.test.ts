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

const buildTestApp = async () => {
  ensureTestEnv();
  const { buildApp } = await import('../src/http/app.js');
  const app = buildApp();
  await app.ready();
  return app;
};

describe('App bootstrap', () => {
  it('responds to health check', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    // debug output for failing status
    if (response.statusCode !== 200) {
      // eslint-disable-next-line no-console
      console.error('health response', response.statusCode, response.payload);
    }
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});

describe('Profile routes', () => {
  it('requires auth for /profile/me', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/profile/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('validates profile id parameter', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/profile/not-a-uuid' });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe('Auth routes', () => {
  it('requires auth for /auth/me', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('Public participants', () => {
  it('rejects invalid sort option', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/artists?sort=oldest' });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe('Moderator routes', () => {
  it('requires auth for submissions queue', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/mod/submissions' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});

describe('Admin routes', () => {
  it('requires auth for user listing', async () => {
    const app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/admin/users' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
