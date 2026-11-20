import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

describe('API (HTTP)', () => {
  let t: TestApp;
  let app: INestApplication;

  beforeAll(async () => {
    t = await createTestApp();
    app = t.app;
  });

  afterAll(async () => {
    await t.close();
  });

  it('GET /health/live returns ok', async () => {
    const res = await request(app.getHttpServer()).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok', service: 'api', version: '1.2.3', checks: {} });
  });

  it('GET /health/ready checks the database and reports Redis as skipped', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.checks).toEqual({ database: 'up', redis: 'skipped' });
  });

  it('unknown routes return RFC 9457 problem details with a request id', async () => {
    const res = await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404, code: 'NOT_FOUND', title: 'NOT FOUND' });
    expect(res.body.requestId).toBe(res.headers['x-request-id']);
  });

  it('echoes a well-formed incoming request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/health/live')
      .set('x-request-id', 'test-req-12345');
    expect(res.headers['x-request-id']).toBe('test-req-12345');
  });

  it('sets security headers', async () => {
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
