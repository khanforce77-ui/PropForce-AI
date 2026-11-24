import type { INestApplication } from '@nestjs/common';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestApp,
  registration,
  resetDatabase,
  resetRateLimits,
  tokenFrom,
  type TestApp,
} from './helpers';

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());

const totpFor = (secret: string) =>
  new TOTP({ secret: Secret.fromBase32(secret), digits: 6, period: 30, algorithm: 'SHA1' });

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
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

async function signedInUser(email?: string) {
  const body = registration(email ? { email } : {});
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const res = await http()
    .post('/v1/auth/login')
    .send({ email: body.email, password: body.password })
    .expect(200);
  return { ...body, auth: { Authorization: `Bearer ${res.body.accessToken as string}` } };
}

/** Enrols TOTP and returns the secret and recovery codes. */
async function enrol(auth: Record<string, string>) {
  const setup = await http().post('/v1/me/mfa/totp/setup').set(auth).expect(200);
  const secret = setup.body.secret as string;
  const confirm = await http()
    .post('/v1/me/mfa/totp/confirm')
    .set(auth)
    .send({ code: totpFor(secret).generate() })
    .expect(200);
  return { secret, recoveryCodes: confirm.body.recoveryCodes as string[] };
}

async function passwordStep(email: string, password: string): Promise<string> {
  const res = await http().post('/v1/auth/login').send({ email, password }).expect(200);
  expect(res.body).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });
  expect(res.headers['set-cookie']).toBeUndefined();
  return res.body.mfaToken;
}

describe('TOTP enrolment', () => {
  it('requires a valid first code, then returns ten recovery codes once', async () => {
    const u = await signedInUser();
    const setup = await http().post('/v1/me/mfa/totp/setup').set(u.auth).expect(200);
    expect(setup.headers['cache-control']).toBe('no-store');
    expect(setup.body.otpauthUri).toMatch(
      /^otpauth:\/\/totp\/PropForce%20AI:sara%40example\.test\?/,
    );

    await http().post('/v1/me/mfa/totp/confirm').set(u.auth).send({ code: '000000' }).expect(401);
    expect((await http().get('/v1/me/mfa').set(u.auth)).body.enabled).toBe(false);

    const confirm = await http()
      .post('/v1/me/mfa/totp/confirm')
      .set(u.auth)
      .send({ code: totpFor(setup.body.secret).generate() })
      .expect(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);
    expect(new Set(confirm.body.recoveryCodes).size).toBe(10);
    expect(confirm.body.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);

    expect((await http().get('/v1/me/mfa').set(u.auth)).body).toEqual({
      enabled: true,
      recoveryCodesRemaining: 10,
    });
    const me = await http().get('/v1/me').set(u.auth).expect(200);
    expect(me.body.user.mfaEnabled).toBe(true);
    expect(me.body.mfaRequired).toBe(true); // owner
  });

  it('stores the secret encrypted and recovery codes only as keyed hashes', async () => {
    const u = await signedInUser();
    const { secret, recoveryCodes } = await enrol(u.auth);
    const factors = await t.owner.mfaFactor.findMany();
    const totp = factors.find((f) => f.type === 'totp')!;
    expect(Buffer.from(totp.secretEncrypted!).toString('latin1')).not.toContain(secret);
    const hashes = factors.filter((f) => f.type === 'recovery_code').map((f) => f.codeHash);
    for (const code of recoveryCodes) expect(hashes).not.toContain(code);
  });

  it('refuses a second enrolment while MFA is on', async () => {
    const u = await signedInUser();
    await enrol(u.auth);
    const res = await http().post('/v1/me/mfa/totp/setup').set(u.auth).expect(409);
    expect(res.body.code).toBe('AUTH_MFA_ALREADY_ENABLED');
  });
});

describe('login with MFA', () => {
  it('needs a second step and rejects a replayed code', async () => {
    const u = await signedInUser();
    const { secret } = await enrol(u.auth);

    // The enrolment code's time step is consumed; use the next step (allowed by the drift window).
    const nextCode = totpFor(secret).generate({ timestamp: Date.now() + 30_000 });
    const mfaToken = await passwordStep(u.email, u.password);
    const ok = await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken, code: nextCode })
      .expect(200);
    expect(ok.body.tokenType).toBe('Bearer');
    expect(ok.headers['set-cookie']).toBeDefined();
    await http().get('/v1/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);

    const again = await passwordStep(u.email, u.password);
    const replay = await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: again, code: nextCode })
      .expect(401);
    expect(replay.body.code).toBe('AUTH_MFA_INVALID');
  });

  it('rejects wrong codes, forged challenge tokens and access tokens used as challenges', async () => {
    const u = await signedInUser();
    await enrol(u.auth);
    const mfaToken = await passwordStep(u.email, u.password);
    await http().post('/v1/auth/mfa/verify').send({ mfaToken, code: '123456' }).expect(401);
    await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: 'x'.repeat(40), code: '123456' })
      .expect(401);
    const accessToken = u.auth.Authorization!.slice(7);
    const res = await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: accessToken, code: '123456' })
      .expect(401);
    expect(res.body.code).toBe('AUTH_MFA_CHALLENGE_INVALID');
  });

  it('requires exactly one of code or recovery code', async () => {
    const res = await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: 'x'.repeat(40), code: '123456', recoveryCode: 'ABCDE-FGHJK' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
  });

  it('accepts each recovery code once (case and dash insensitive)', async () => {
    const u = await signedInUser();
    const { recoveryCodes } = await enrol(u.auth);
    const code = recoveryCodes[0]!;

    const first = await passwordStep(u.email, u.password);
    const ok = await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: first, recoveryCode: code.toLowerCase().replace('-', '') })
      .expect(200);
    const auth = { Authorization: `Bearer ${ok.body.accessToken}` };
    expect((await http().get('/v1/me/mfa').set(auth)).body.recoveryCodesRemaining).toBe(9);

    const second = await passwordStep(u.email, u.password);
    await http()
      .post('/v1/auth/mfa/verify')
      .send({ mfaToken: second, recoveryCode: code })
      .expect(401);
  });
});

describe('disabling MFA', () => {
  it('requires the password and a valid second factor', async () => {
    const u = await signedInUser();
    const { recoveryCodes } = await enrol(u.auth);

    await http()
      .post('/v1/me/mfa/disable')
      .set(u.auth)
      .send({ password: 'wrong password!!', recoveryCode: recoveryCodes[0] })
      .expect(401);
    await http()
      .post('/v1/me/mfa/disable')
      .set(u.auth)
      .send({ password: u.password, recoveryCode: 'ZZZZZ-ZZZZZ' })
      .expect(401);
    await http()
      .post('/v1/me/mfa/disable')
      .set(u.auth)
      .send({ password: u.password, recoveryCode: recoveryCodes[1] })
      .expect(204);

    expect(await t.owner.mfaFactor.count()).toBe(0);
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: u.email, password: u.password })
      .expect(200);
    expect(login.body.accessToken).toBeDefined();
  });
});

describe('MFA rate limits', () => {
  it('count guesses per account, so one person cannot lock out colleagues on the same network', async () => {
    const a = await signedInUser('a@example.test');
    const b = await signedInUser('b@example.test');
    await http().post('/v1/me/mfa/totp/setup').set(a.auth).expect(200);
    const setupB = await http().post('/v1/me/mfa/totp/setup').set(b.auth).expect(200);
    for (let i = 0; i < 5; i++) {
      await http().post('/v1/me/mfa/totp/confirm').set(a.auth).send({ code: '000000' }).expect(401);
    }
    await http().post('/v1/me/mfa/totp/confirm').set(a.auth).send({ code: '000000' }).expect(429);
    // Same IP address, different account: not blocked.
    await http()
      .post('/v1/me/mfa/totp/confirm')
      .set(b.auth)
      .send({ code: totpFor(setupB.body.secret).generate() })
      .expect(200);
  });
});
