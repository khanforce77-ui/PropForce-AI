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

type Headers = Record<string, string>;
interface Actor {
  userId: string;
  email: string;
  password: string;
  auth: Headers;
}
interface Owner extends Actor {
  tenantId: string;
  membershipId: string;
  /** Auth + tenant headers. */
  h: Headers;
}

async function loginAs(email: string, password: string): Promise<Headers> {
  const res = await http().post('/v1/auth/login').send({ email, password }).expect(200);
  return { Authorization: `Bearer ${res.body.accessToken as string}` };
}

async function enableMfa(auth: Headers): Promise<void> {
  const setup = await http().post('/v1/me/mfa/totp/setup').set(auth).expect(200);
  const code = new TOTP({
    secret: Secret.fromBase32(setup.body.secret),
    digits: 6,
    period: 30,
  }).generate();
  await http().post('/v1/me/mfa/totp/confirm').set(auth).send({ code }).expect(200);
}

/** Registers an agency owner with MFA enabled. */
async function createOwner(email: string, agencyName: string, withMfa = true): Promise<Owner> {
  const body = registration({ email, agency: { name: agencyName, emirate: 'Dubai' } });
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const auth = await loginAs(email, body.password);
  if (withMfa) await enableMfa(auth);
  const me = await http().get('/v1/me').set(auth).expect(200);
  const m = me.body.memberships[0];
  return {
    userId: me.body.user.id,
    email,
    password: body.password,
    auth,
    tenantId: m.agency.id,
    membershipId: m.id,
    h: { ...auth, 'X-Tenant-Id': m.agency.id },
  };
}

/** Invites a new person and accepts as them; returns their headers for this agency. */
describe('platform admin', () => {
  it('shows platform admins every agency, user and listing; refuses everyone else', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes', false);
    await t.owner.agencySettings.update({
      where: { tenantId: a.tenantId },
      data: { requirePermitToPublish: false },
    });
    const listing = await http()
      .post('/v1/properties')
      .set(a.h)
      .send({
        listingType: 'sale',
        propertyType: 'villa',
        emirate: 'Dubai',
        community: 'Arabian Ranches',
        price: 5_000_000,
        areaSqft: 3000,
      })
      .expect(201);
    await http()
      .post(`/v1/properties/${listing.body.id as string}/status`)
      .set(a.h)
      .send({ status: 'active' })
      .expect(200);

    // Not a platform admin → refused.
    expect((await http().get('/v1/platform/summary').set(a.auth).expect(403)).body.code).toBe(
      'PERMISSION_DENIED',
    );
    await http().get('/v1/platform/summary').expect(401);

    // Flag Bravo's owner: still refused until two-factor is on.
    await t.owner.user.update({ where: { id: b.userId }, data: { isPlatformAdmin: true } });
    expect((await http().get('/v1/platform/summary').set(b.auth).expect(403)).body.code).toBe(
      'MFA_REQUIRED',
    );
    const me = await http().get('/v1/me').set(b.auth).expect(200);
    expect(me.body.user.isPlatformAdmin).toBe(true);
    expect(me.body.mfaRequired).toBe(true);
    await enableMfa(b.auth);

    const summary = await http().get('/v1/platform/summary').set(b.auth).expect(200);
    expect(summary.body).toMatchObject({
      agencies: { total: 2, newThisWeek: 2 },
      users: { total: 2, verified: 2, newThisWeek: 2 },
      listings: { total: 1, live: 1, draft: 0 },
    });
    const agencies = await http().get('/v1/platform/agencies').set(b.auth).expect(200);
    expect(agencies.body.data).toHaveLength(2);
    const alpha = agencies.body.data.find((x: { name: string }) => x.name === 'Alpha Realty');
    expect(alpha).toMatchObject({
      members: 1,
      listings: 1,
      owner: { email: 'owner@a.test' },
    });
    const users = await http().get('/v1/platform/users').set(b.auth).expect(200);
    expect(users.body.data.map((u: { email: string }) => u.email).sort()).toEqual([
      'owner@a.test',
      'owner@b.test',
    ]);
    expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|password_hash/);
  });
});
