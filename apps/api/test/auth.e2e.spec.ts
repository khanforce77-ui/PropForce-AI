import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  refreshCookieFrom,
  registration,
  resetDatabase,
  resetRateLimits,
  tokenFrom,
  type TestApp,
} from './helpers';

const CSRF = { 'x-propforce-csrf': '1' };

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  t = await createTestApp({ SUPPORTED_EMIRATES: 'Dubai', AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
  app = t.app;
});

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await resetDatabase(t.owner);
  resetRateLimits(app);
  t.emails.length = 0;
});

/** Registers and verifies a user, returning their credentials. */
async function registerVerified(overrides: Record<string, unknown> = {}) {
  const body = registration(overrides);
  await http().post('/v1/auth/register').send(body).expect(202);
  const token = tokenFrom(t.emails.at(-1));
  await http().post('/v1/auth/verify-email').send({ token }).expect(204);
  return body;
}

async function login(email: string, password: string) {
  const res = await http().post('/v1/auth/login').send({ email, password }).expect(200);
  return {
    accessToken: res.body.accessToken as string,
    cookie: refreshCookieFrom(res.headers['set-cookie']),
  };
}

describe('registration', () => {
  it('creates the user, agency, settings, owner membership and audit entry, then emails a verification link', async () => {
    const res = await http().post('/v1/auth/register').send(registration()).expect(202);
    expect(res.body.message).toMatch(/verification email/);

    const user = await t.owner.user.findUniqueOrThrow({ where: { email: 'sara@example.test' } });
    expect(user.emailVerifiedAt).toBeNull();
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);

    const membership = await t.owner.membership.findFirstOrThrow({
      where: { userId: user.id },
      include: { agency: { include: { settings: true } } },
    });
    expect(membership.role).toBe('owner');
    expect(membership.agency.name).toBe('Marina Homes Real Estate');
    expect(membership.agency.emirate).toBe('Dubai');
    expect(membership.agency.status).toBe('pending');
    expect(membership.agency.slug).toMatch(/^marina-homes-real-estate-[0-9a-f]{6}$/);
    expect(membership.agency.settings?.outboundVoiceEnabled).toBe(false);

    const audit = await t.owner.auditLog.findMany({ where: { tenantId: membership.tenantId } });
    expect(audit.map((a) => a.action)).toEqual(['agency.registered']);

    expect(t.emails).toHaveLength(1);
    expect(t.emails[0]!.to).toBe('sara@example.test');
    const stored = await t.owner.userToken.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(tokenFrom(t.emails[0])); // only the hash is stored
  });

  it('normalizes email case and whitespace', async () => {
    await http()
      .post('/v1/auth/register')
      .send(registration({ email: '  Sara@Example.TEST ' }))
      .expect(202);
    expect(await t.owner.user.count({ where: { email: 'sara@example.test' } })).toBe(1);
  });

  it('gives the same response for an existing email and sends a notice instead of creating anything', async () => {
    await http().post('/v1/auth/register').send(registration()).expect(202);
    t.emails.length = 0;
    const res = await http()
      .post('/v1/auth/register')
      .send(registration({ agency: { name: 'Another Agency', emirate: 'Dubai' } }))
      .expect(202);
    expect(res.body.message).toMatch(/verification email/);
    expect(await t.owner.user.count()).toBe(1);
    expect(await t.owner.agency.count()).toBe(1);
    expect(t.emails[0]!.subject).toMatch(/tried to register/);
  });

  it('rejects emirates that are not enabled in configuration', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send(registration({ agency: { name: 'Capital Homes', emirate: 'Abu Dhabi' } }))
      .expect(400);
    expect(res.body.errors[0].path).toBe('agency.emirate');
    expect(await t.owner.user.count()).toBe(0);
  });

  it('validates input and rejects unknown fields', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send({ ...registration({ password: 'short' }), isPlatformAdmin: true })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    const paths = res.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toContain('password');
    expect(paths.some((p: string) => p === '(root)' || p === 'isPlatformAdmin')).toBe(true);
  });
});

describe('email verification', () => {
  it('blocks login until the email is verified, and tokens are single use', async () => {
    const body = registration();
    await http().post('/v1/auth/register').send(body).expect(202);
    const login1 = await http()
      .post('/v1/auth/login')
      .send({ email: body.email, password: body.password });
    expect(login1.status).toBe(403);
    expect(login1.body.code).toBe('AUTH_EMAIL_UNVERIFIED');

    const token = tokenFrom(t.emails[0]);
    await http().post('/v1/auth/verify-email').send({ token }).expect(204);
    const reuse = await http().post('/v1/auth/verify-email').send({ token }).expect(400);
    expect(reuse.body.code).toBe('AUTH_TOKEN_INVALID');

    await http()
      .post('/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(200);
  });

  it('resending invalidates the previous link', async () => {
    const body = registration();
    await http().post('/v1/auth/register').send(body).expect(202);
    const first = tokenFrom(t.emails[0]);
    await http().post('/v1/auth/resend-verification').send({ email: body.email }).expect(202);
    const second = tokenFrom(t.emails[1]);
    await http().post('/v1/auth/verify-email').send({ token: first }).expect(400);
    await http().post('/v1/auth/verify-email').send({ token: second }).expect(204);
  });

  it('rejects expired tokens', async () => {
    await http().post('/v1/auth/register').send(registration()).expect(202);
    await t.owner.userToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await http()
      .post('/v1/auth/verify-email')
      .send({ token: tokenFrom(t.emails[0]) })
      .expect(400);
  });
});

describe('login and sessions', () => {
  it('returns the same error for a wrong password and an unknown email', async () => {
    const body = await registerVerified();
    const wrong = await http()
      .post('/v1/auth/login')
      .send({ email: body.email, password: 'wrong password!!' })
      .expect(401);
    const unknown = await http()
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.test', password: 'whatever12345' })
      .expect(401);
    expect(wrong.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(unknown.body.code).toBe(wrong.body.code);
    expect(unknown.body.detail).toBe(wrong.body.detail);
  });

  it('issues a short-lived access token and an httpOnly SameSite=Strict refresh cookie', async () => {
    const body = await registerVerified();
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(200);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(res.headers['cache-control']).toBe('no-store');
    const raw = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('pf_refresh='),
    )!;
    expect(raw).toMatch(/HttpOnly/);
    expect(raw).toMatch(/SameSite=Strict/);
    expect(raw).toMatch(/Path=\/v1\/auth/);
  });

  it('GET /v1/me returns the user and their agency memberships', async () => {
    const body = await registerVerified();
    const { accessToken } = await login(body.email, body.password);
    const res = await http()
      .get('/v1/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(res.body.user.email).toBe(body.email);
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.memberships).toHaveLength(1);
    expect(res.body.memberships[0]).toMatchObject({
      role: 'owner',
      agency: { name: 'Marina Homes Real Estate' },
    });
  });

  it('rejects missing, malformed and forged access tokens', async () => {
    await http().get('/v1/me').expect(401);
    await http().get('/v1/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    // Unsigned ("alg: none") token for a real session id, built at runtime.
    const body = await registerVerified();
    await login(body.email, body.password);
    const session = await t.owner.session.findFirstOrThrow();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none' })}.${b64({ sub: session.userId, sid: session.id })}.`;
    await http().get('/v1/me').set('Authorization', `Bearer ${unsigned}`).expect(401);
  });

  it('refresh requires the CSRF header', async () => {
    const body = await registerVerified();
    const { cookie } = await login(body.email, body.password);
    const res = await http().post('/v1/auth/refresh').set('Cookie', cookie).expect(403);
    expect(res.body.code).toBe('CSRF_HEADER_MISSING');
  });

  it('rotates refresh tokens and revokes the whole family when an old token is reused', async () => {
    const body = await registerVerified();
    const first = await login(body.email, body.password);

    const r1 = await http()
      .post('/v1/auth/refresh')
      .set(CSRF)
      .set('Cookie', first.cookie)
      .expect(200);
    const second = {
      accessToken: r1.body.accessToken as string,
      cookie: refreshCookieFrom(r1.headers['set-cookie']),
    };
    expect(second.cookie).not.toBe(first.cookie);

    // The previous access token is bound to the rotated session and stops working.
    await http().get('/v1/me').set('Authorization', `Bearer ${first.accessToken}`).expect(401);
    await http().get('/v1/me').set('Authorization', `Bearer ${second.accessToken}`).expect(200);

    // Replaying the first refresh token is treated as theft.
    await http().post('/v1/auth/refresh').set(CSRF).set('Cookie', first.cookie).expect(401);
    await http().post('/v1/auth/refresh').set(CSRF).set('Cookie', second.cookie).expect(401);
    await http().get('/v1/me').set('Authorization', `Bearer ${second.accessToken}`).expect(401);
  });

  it('logout revokes the session immediately', async () => {
    const body = await registerVerified();
    const s = await login(body.email, body.password);
    await http().post('/v1/auth/logout').set(CSRF).set('Cookie', s.cookie).expect(204);
    await http().get('/v1/me').set('Authorization', `Bearer ${s.accessToken}`).expect(401);
    await http().post('/v1/auth/refresh').set(CSRF).set('Cookie', s.cookie).expect(401);
  });

  it('lists active sessions and revokes another device', async () => {
    const body = await registerVerified();
    const laptop = await login(body.email, body.password);
    const phone = await login(body.email, body.password);

    const list = await http()
      .get('/v1/me/sessions')
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .expect(200);
    expect(list.body.data).toHaveLength(2);
    const phoneSession = list.body.data.find((s: { current: boolean }) => !s.current);

    await http()
      .delete(`/v1/me/sessions/${phoneSession.id}`)
      .set('Authorization', `Bearer ${laptop.accessToken}`)
      .expect(204);
    await http().get('/v1/me').set('Authorization', `Bearer ${phone.accessToken}`).expect(401);
    await http().get('/v1/me').set('Authorization', `Bearer ${laptop.accessToken}`).expect(200);
  });

  it('cannot revoke another user’s session', async () => {
    const a = await registerVerified();
    const b = await registerVerified({
      email: 'omar@example.test',
      agency: { name: 'Bravo Realty', emirate: 'Dubai' },
    });
    const sa = await login(a.email, a.password);
    const sb = await login(b.email, b.password);
    const bSessions = await http()
      .get('/v1/me/sessions')
      .set('Authorization', `Bearer ${sb.accessToken}`)
      .expect(200);
    await http()
      .delete(`/v1/me/sessions/${bSessions.body.data[0].id}`)
      .set('Authorization', `Bearer ${sa.accessToken}`)
      .expect(404);
    await http().get('/v1/me').set('Authorization', `Bearer ${sb.accessToken}`).expect(200);
  });
});

describe('password reset', () => {
  it('answers identically for unknown emails and sends nothing', async () => {
    const res = await http()
      .post('/v1/auth/password/forgot')
      .send({ email: 'nobody@example.test' })
      .expect(202);
    expect(res.body.message).toMatch(/If an account exists/);
    expect(t.emails).toHaveLength(0);
  });

  it('resets the password, signs out every session and makes the link single use', async () => {
    const body = await registerVerified();
    const s = await login(body.email, body.password);
    t.emails.length = 0;

    await http().post('/v1/auth/password/forgot').send({ email: body.email }).expect(202);
    const token = tokenFrom(t.emails[0]);
    await http()
      .post('/v1/auth/password/reset')
      .send({ token, newPassword: 'a brand new passphrase' })
      .expect(204);

    await http().get('/v1/me').set('Authorization', `Bearer ${s.accessToken}`).expect(401);
    await http()
      .post('/v1/auth/login')
      .send({ email: body.email, password: body.password })
      .expect(401);
    await http()
      .post('/v1/auth/login')
      .send({ email: body.email, password: 'a brand new passphrase' })
      .expect(200);
    await http()
      .post('/v1/auth/password/reset')
      .send({ token, newPassword: 'yet another passphrase' })
      .expect(400);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per client', async () => {
    const limited = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) {
        const res = await request(limited.app.getHttpServer())
          .post('/v1/auth/login')
          .send({ email: 'x@example.test', password: 'whatever12345' });
        statuses.push(res.status);
      }
      expect(statuses).toEqual([401, 401, 401, 429]);
    } finally {
      await limited.close();
    }
  });
});
