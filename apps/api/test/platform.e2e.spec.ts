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

async function platformAdmin(email = 'root@platform.test') {
  const admin = await createOwner(email, 'Platform HQ');
  await t.owner.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
  return admin;
}

async function setFlag(key: string, enabled: boolean) {
  await t.owner.featureFlag.update({ where: { key }, data: { enabled } });
}

describe('platform controls', () => {
  it('approval queue: new agencies wait, cannot publish or invite, then get approved or rejected', async () => {
    const admin = await platformAdmin();
    await setFlag('platform.require_agency_approval', true);
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const done = await http().post('/v1/agency/onboarding/complete').set(a.h).expect(200);
    expect(done.body).toMatchObject({ status: 'pending', approvalStatus: 'pending' });

    const blocked = await http()
      .post('/v1/invitations')
      .set(a.h)
      .send({ email: 'x@a.test', role: 'agent' })
      .expect(403);
    expect(blocked.body.code).toBe('AGENCY_AWAITING_APPROVAL');

    // Agents of other agencies cannot use the platform routes.
    await http().post(`/v1/platform/agencies/${a.tenantId}/approve`).set(a.auth).expect(403);

    const approved = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/approve`)
      .set(admin.auth)
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'active', approvalStatus: 'approved' });
    await http()
      .post('/v1/invitations')
      .set(a.h)
      .send({ email: 'x@a.test', role: 'agent' })
      .expect(201);

    const b = await createOwner('owner@b.test', 'Bravo Homes');
    await http().post('/v1/agency/onboarding/complete').set(b.h).expect(200);
    await http()
      .post(`/v1/platform/agencies/${b.tenantId}/reject`)
      .set(admin.auth)
      .send({ reason: 'Trade licence could not be confirmed' })
      .expect(200);
    const after = await http().get('/v1/agency').set(b.h).expect(403);
    expect(after.body.code).toBeDefined();
    const me = await http().get('/v1/me').set(b.auth).expect(200);
    expect(me.body.memberships[0].agency).toMatchObject({
      status: 'cancelled',
      approvalStatus: 'rejected',
      statusReason: 'Trade licence could not be confirmed',
    });

    // Both sides of the record: the agency's audit log and the platform audit log.
    const tenantAudit = await t.owner.auditLog.findMany({
      where: { tenantId: a.tenantId, actorType: 'platform' },
    });
    expect(tenantAudit.map((r) => r.action)).toEqual(['platform.agency_approved']);
    const log = await http().get('/v1/platform/audit-log').set(admin.auth).expect(200);
    expect(log.body.data.map((r: { action: string }) => r.action)).toEqual([
      'platform.agency_rejected',
      'platform.agency_approved',
    ]);
    expect(log.body.data[0].after.by).toBe('root@platform.test');
  });

  it('suspends and reactivates an agency', async () => {
    const admin = await platformAdmin();
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    await http().post('/v1/agency/onboarding/complete').set(a.h).expect(200);
    await http()
      .post(`/v1/platform/agencies/${a.tenantId}/suspend`)
      .set(admin.auth)
      .send({ reason: 'Unpaid invoice' })
      .expect(200);
    expect((await http().get('/v1/agency').set(a.h).expect(403)).body.code).toBe(
      'TENANT_SUSPENDED',
    );
    await http()
      .post(`/v1/platform/agencies/${a.tenantId}/suspend`)
      .set(admin.auth)
      .send({ reason: 'again' })
      .expect(409);
    const back = await http()
      .post(`/v1/platform/agencies/${a.tenantId}/reactivate`)
      .set(admin.auth)
      .expect(200);
    expect(back.body).toMatchObject({ status: 'active', statusReason: null });
    await http().get('/v1/agency').set(a.h).expect(200);
  });

  it('enforces plan limits for seats and listings', async () => {
    const admin = await platformAdmin();
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    await http()
      .patch(`/v1/platform/agencies/${a.tenantId}`)
      .set(admin.auth)
      .send({ plan: 'starter', seatLimit: 2, listingLimit: 1 })
      .expect(200);
    await http()
      .post('/v1/invitations')
      .set(a.h)
      .send({ email: 'one@a.test', role: 'agent' })
      .expect(201);
    // Re-inviting the same person replaces their pending invitation, so it still fits.
    await http()
      .post('/v1/invitations')
      .set(a.h)
      .send({ email: 'one@a.test', role: 'agent' })
      .expect(201);
    const seat = await http()
      .post('/v1/invitations')
      .set(a.h)
      .send({ email: 'two@a.test', role: 'agent' })
      .expect(409);
    expect(seat.body.code).toBe('PLAN_LIMIT_REACHED');

    const listing = {
      listingType: 'sale',
      propertyType: 'apartment',
      emirate: 'Dubai',
    };
    await http().post('/v1/properties').set(a.h).send(listing).expect(201);
    expect((await http().post('/v1/properties').set(a.h).send(listing).expect(409)).body.code).toBe(
      'PLAN_LIMIT_REACHED',
    );

    await http()
      .patch(`/v1/platform/agencies/${a.tenantId}`)
      .set(admin.auth)
      .send({ seatLimit: 0 })
      .expect(400);
    await http()
      .patch(`/v1/platform/agencies/${a.tenantId}`)
      .set(admin.auth)
      .send({ listingLimit: null })
      .expect(200);
    await http().post('/v1/properties').set(a.h).send(listing).expect(201);
  });

  it('suspends a user everywhere at once, and reactivates them', async () => {
    const admin = await platformAdmin();
    const a = await createOwner('owner@a.test', 'Alpha Realty', false);
    await http()
      .post(`/v1/platform/users/${admin.userId}/suspend`)
      .set(admin.auth)
      .send({ reason: 'self' })
      .expect(403);
    await http()
      .post(`/v1/platform/users/${a.userId}/suspend`)
      .set(admin.auth)
      .send({ reason: 'Reported for spam' })
      .expect(200);
    // The existing access token stops working immediately; signing in again is refused.
    await http().get('/v1/me').set(a.auth).expect(401);
    const login = await http()
      .post('/v1/auth/login')
      .send({ email: a.email, password: a.password })
      .expect(403);
    expect(login.body.code).toBe('ACCOUNT_SUSPENDED');

    await http().post(`/v1/platform/users/${a.userId}/reactivate`).set(admin.auth).expect(200);
    await http().post('/v1/auth/login').send({ email: a.email, password: a.password }).expect(200);
  });

  it('turns sign-ups off and on', async () => {
    const admin = await platformAdmin();
    const flags = await http().get('/v1/platform/settings').set(admin.auth).expect(200);
    expect(flags.body.data.map((f: { key: string }) => f.key)).toEqual(
      expect.arrayContaining([
        'platform.allow_signups',
        'platform.require_agency_approval',
        'voice.outbound_calls',
      ]),
    );
    await http()
      .patch('/v1/platform/settings/platform.allow_signups')
      .set(admin.auth)
      .send({ enabled: false })
      .expect(200);
    const closed = await http()
      .post('/v1/auth/register')
      .send(registration({ email: 'late@c.test' }))
      .expect(403);
    expect(closed.body.code).toBe('SIGNUPS_CLOSED');
    await http()
      .patch('/v1/platform/settings/platform.allow_signups')
      .set(admin.auth)
      .send({ enabled: true })
      .expect(200);
    await http()
      .patch('/v1/platform/settings/nope')
      .set(admin.auth)
      .send({ enabled: true })
      .expect(404);
  });
});

describe('platform admin inside any agency', () => {
  it('can read and change another agency’s listings and leads, audited as the platform', async () => {
    const admin = await platformAdmin();
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const asAdmin = { ...admin.auth, 'X-Tenant-Id': a.tenantId };

    const listing = await http()
      .post('/v1/properties')
      .set(a.h)
      .send({ listingType: 'sale', propertyType: 'villa', emirate: 'Dubai' })
      .expect(201);
    await http().get('/v1/properties').set(asAdmin).expect(200);
    await http()
      .patch(`/v1/properties/${listing.body.id}`)
      .set(asAdmin)
      .send({ title: 'Fixed by PropForce' })
      .expect(200);
    const contact = await http()
      .post('/v1/contacts')
      .set(asAdmin)
      .send({ fullName: 'Walk In', phone: '0501231234' })
      .expect(201);
    expect(contact.body.ownerMembershipId).toBeNull();
    await http().get('/v1/contacts?mine=true').set(asAdmin).expect(200);
    await http().get('/v1/dashboard/summary').set(asAdmin).expect(200);

    // The agency sees the change in its own audit log as made by the platform ...
    const logs = await http().get('/v1/audit-logs?entityType=property').set(a.h).expect(200);
    expect(logs.body.data[0]).toMatchObject({ action: 'property.updated', actorType: 'platform' });
    // ... and the platform log records it too.
    const platformLog = await http().get('/v1/platform/audit-log').set(admin.auth).expect(200);
    expect(platformLog.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['agency_data.property.updated', 'agency_data.contact.created']),
    );

    // Everything is visible in the all-listings view.
    const all = await http().get('/v1/platform/listings').set(admin.auth).expect(200);
    expect(all.body.data[0]).toMatchObject({
      id: listing.body.id,
      agency: { id: a.tenantId, name: 'Alpha Realty' },
    });
  });

  it('is refused to other agency members and to admins without two-factor', async () => {
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const b = await createOwner('owner@bravo.test', 'Bravo Homes');
    await http()
      .get('/v1/properties')
      .set({ ...b.auth, 'X-Tenant-Id': a.tenantId })
      .expect(403);
    const noMfa = await createOwner('root2@platform.test', 'HQ Two', false);
    await t.owner.user.update({ where: { id: noMfa.userId }, data: { isPlatformAdmin: true } });
    await http()
      .get('/v1/properties')
      .set({ ...noMfa.auth, 'X-Tenant-Id': a.tenantId })
      .expect(403);
  });

  it('PropForce Direct: created once, admin is its owner and can list there', async () => {
    const admin = await platformAdmin();
    const first = await http().post('/v1/platform/direct').set(admin.auth).expect(200);
    const second = await http().post('/v1/platform/direct').set(admin.auth).expect(200);
    expect(second.body.agencyId).toBe(first.body.agencyId);
    const me = await http().get('/v1/me').set(admin.auth).expect(200);
    const direct = me.body.memberships.find(
      (m: { agency: { id: string } }) => m.agency.id === first.body.agencyId,
    );
    expect(direct).toMatchObject({
      role: 'owner',
      agency: { name: 'PropForce Direct', status: 'active' },
    });
    const h = { ...admin.auth, 'X-Tenant-Id': first.body.agencyId };
    const listing = await http()
      .post('/v1/properties')
      .set(h)
      .send({ listingType: 'rent', propertyType: 'apartment', emirate: 'Dubai', price: 90_000 })
      .expect(201);
    expect(listing.body.assignedMembershipId).toBe(direct.id);
    const agencies = await http().get('/v1/platform/agencies').set(admin.auth).expect(200);
    expect(
      agencies.body.data.filter((x: { isPlatformOwned: boolean }) => x.isPlatformOwned),
    ).toHaveLength(1);
    // Non-admins cannot create it.
    const o = await createOwner('owner@alpha.test', 'Alpha Realty');
    await http().post('/v1/platform/direct').set(o.auth).expect(403);
  });
});
