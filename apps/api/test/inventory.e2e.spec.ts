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
async function inviteNew(inviter: Owner, email: string, role: string, mfa = false) {
  await http().post('/v1/invitations').set(inviter.h).send({ email, role }).expect(201);
  const token = tokenFrom(t.emails.at(-1));
  const password = 'invited person passphrase';
  const accepted = await http()
    .post('/v1/invitations/accept')
    .send({ token, fullName: `Invited ${role}`, password })
    .expect(200);
  expect(accepted.body).toMatchObject({ tenantId: inviter.tenantId, newAccount: true });
  const auth = await loginAs(email, password);
  if (mfa) await enableMfa(auth);
  return {
    membershipId: accepted.body.membershipId as string,
    auth,
    h: { ...auth, 'X-Tenant-Id': inviter.tenantId },
  };
}

const draft = (overrides: Record<string, unknown> = {}) => ({
  listingType: 'sale',
  propertyType: 'apartment',
  emirate: 'Dubai',
  community: 'Dubai Marina',
  building: 'Marina Gate 1',
  bedrooms: 2,
  bathrooms: 2,
  areaSqft: 1250.5,
  price: 2_350_000,
  ...overrides,
});

const permit = { authority: 'DLD', permitNumber: '7100012345', validUntil: '2099-12-31' };

describe('listings', () => {
  it('creates a draft with a generated reference, assigned to the creator, and audits it', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const res = await http().post('/v1/properties').set(o.h).send(draft()).expect(201);
    expect(res.body).toMatchObject({
      status: 'draft',
      reference: expect.stringMatching(/^PF-[A-Z0-9]{6}$/),
      assignedMembershipId: o.membershipId,
      price: '2350000',
      areaSqft: '1250.5',
      rentPeriod: null,
    });
    const logs = await http().get('/v1/audit-logs?entityType=property').set(o.h).expect(200);
    expect(logs.body.data[0]).toMatchObject({ action: 'property.created', entityId: res.body.id });
  });

  it('rejects unsupported emirates, bad numbers and a rent period on a sale', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const bad = async (body: Record<string, unknown>) =>
      (await http().post('/v1/properties').set(o.h).send(body).expect(400)).body.code;
    expect(await bad(draft({ emirate: 'Sharjah' }))).toBe('VALIDATION_FAILED');
    expect(await bad(draft({ price: -1 }))).toBe('VALIDATION_FAILED');
    expect(await bad(draft({ rentPeriod: 'yearly' }))).toBe('VALIDATION_FAILED');
    expect(await bad(draft({ tenantId: o.tenantId }))).toBe('VALIDATION_FAILED');
  });

  it('defaults rentals to a yearly rent period', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const res = await http()
      .post('/v1/properties')
      .set(o.h)
      .send(draft({ listingType: 'rent', price: 120_000 }))
      .expect(201);
    expect(res.body.rentPeriod).toBe('yearly');
  });

  it('refuses a duplicate reference within the agency', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await http()
      .post('/v1/properties')
      .set(o.h)
      .send(draft({ reference: 'AR-1' }))
      .expect(201);
    const dup = await http()
      .post('/v1/properties')
      .set(o.h)
      .send(draft({ reference: 'AR-1' }))
      .expect(409);
    expect(dup.body.code).toBe('CONFLICT_DUPLICATE');
  });

  it('lists with filters, search and pagination, hiding archived by default', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    for (let i = 0; i < 3; i++) {
      await http()
        .post('/v1/properties')
        .set(o.h)
        .send(draft({ reference: `S-${i}`, bedrooms: i }))
        .expect(201);
    }
    await http()
      .post('/v1/properties')
      .set(o.h)
      .send(draft({ reference: 'R-1', listingType: 'rent', community: 'JVC', price: 90_000 }))
      .expect(201);

    const all = await http().get('/v1/properties?limit=2').set(o.h).expect(200);
    expect(all.body.total).toBe(4);
    expect(all.body.data).toHaveLength(2);
    const next = await http()
      .get(`/v1/properties?limit=2&cursor=${all.body.nextCursor as string}`)
      .set(o.h)
      .expect(200);
    expect(next.body.data).toHaveLength(2);
    expect(next.body.nextCursor).toBeNull();

    const rent = await http().get('/v1/properties?listingType=rent').set(o.h).expect(200);
    expect(rent.body.data.map((p: { reference: string }) => p.reference)).toEqual(['R-1']);
    const search = await http().get('/v1/properties?q=jvc').set(o.h).expect(200);
    expect(search.body.total).toBe(1);
    const beds = await http().get('/v1/properties?bedrooms=1').set(o.h).expect(200);
    expect(beds.body.data[0].reference).toBe('S-1');
    const cheap = await http().get('/v1/properties?maxPrice=100000').set(o.h).expect(200);
    expect(cheap.body.total).toBe(1);

    const id = rent.body.data[0].id as string;
    await http()
      .post(`/v1/properties/${id}/status`)
      .set(o.h)
      .send({ status: 'archived' })
      .expect(200);
    expect((await http().get('/v1/properties').set(o.h).expect(200)).body.total).toBe(3);
    expect(
      (await http().get('/v1/properties?status=archived').set(o.h).expect(200)).body.total,
    ).toBe(1);
  });

  it('publishes only complete listings with a valid permit, then sets freshness', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const p = (
      await http()
        .post('/v1/properties')
        .set(o.h)
        .send(draft({ price: null, community: null }))
        .expect(201)
    ).body;
    const blocked = await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(422);
    expect(blocked.body.code).toBe('LISTING_INCOMPLETE');
    expect(blocked.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'community',
      'permits',
      'price',
    ]);

    await http()
      .patch(`/v1/properties/${p.id}`)
      .set(o.h)
      .send({ price: 1_900_000, community: 'Business Bay' })
      .expect(200);
    await http()
      .post(`/v1/properties/${p.id}/permits`)
      .set(o.h)
      .send({ ...permit, permitNumber: '7100000001', validUntil: '2020-01-01' })
      .expect(201);
    // An expired permit does not count.
    await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(422);

    await http().post(`/v1/properties/${p.id}/permits`).set(o.h).send(permit).expect(201);
    const live = await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(200);
    expect(live.body.status).toBe('active');
    const days = (new Date(live.body.listingExpiresAt).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
    expect(live.body.verifiedAt).not.toBeNull();
    expect(live.body.permits).toHaveLength(2);
  });

  it('can publish without a permit when the agency turns the requirement off', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await t.owner.agencySettings.update({
      where: { tenantId: o.tenantId },
      data: { requirePermitToPublish: false },
    });
    const p = (await http().post('/v1/properties').set(o.h).send(draft()).expect(201)).body;
    await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(200);
  });

  it('enforces the status lifecycle', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await t.owner.agencySettings.update({
      where: { tenantId: o.tenantId },
      data: { requirePermitToPublish: false },
    });
    const p = (await http().post('/v1/properties').set(o.h).send(draft()).expect(201)).body;
    const move = (status: string, code = 200) =>
      http().post(`/v1/properties/${p.id}/status`).set(o.h).send({ status }).expect(code);
    expect((await move('sold', 409)).body.code).toBe('INVALID_STATUS_CHANGE');
    await move('active');
    expect((await move('rented', 409)).body.code).toBe('INVALID_STATUS_CHANGE');
    await move('under_offer');
    await move('sold');
    await move('active', 409);
    await move('archived');
    await move('draft');
  });

  it('lets an agent edit only their own listings and not reassign them', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const ownersListing = (await http().post('/v1/properties').set(o.h).send(draft()).expect(201))
      .body;
    const mine = (await http().post('/v1/properties').set(agent.h).send(draft()).expect(201)).body;
    expect(mine.assignedMembershipId).toBe(agent.membershipId);

    // Agents can read everything in the agency …
    expect((await http().get('/v1/properties').set(agent.h).expect(200)).body.total).toBe(2);
    expect((await http().get('/v1/properties?mine=true').set(agent.h).expect(200)).body.total).toBe(
      1,
    );
    // … but change only their own listings.
    await http().patch(`/v1/properties/${mine.id}`).set(agent.h).send({ bedrooms: 3 }).expect(200);
    await http()
      .patch(`/v1/properties/${ownersListing.id}`)
      .set(agent.h)
      .send({ bedrooms: 3 })
      .expect(403);
    await http()
      .patch(`/v1/properties/${mine.id}`)
      .set(agent.h)
      .send({ assignedMembershipId: o.membershipId })
      .expect(403);
    await http()
      .post('/v1/properties')
      .set(agent.h)
      .send(draft({ assignedMembershipId: o.membershipId }))
      .expect(403);
    await http()
      .post('/v1/projects')
      .set(agent.h)
      .send({ name: 'X', emirate: 'Dubai' })
      .expect(403);

    // The owner can reassign the agent's listing to themselves.
    const moved = await http()
      .patch(`/v1/properties/${mine.id}`)
      .set(o.h)
      .send({ assignedMembershipId: o.membershipId })
      .expect(200);
    expect(moved.body.assigned.id).toBe(o.membershipId);
    await http().patch(`/v1/properties/${mine.id}`).set(agent.h).send({ bedrooms: 1 }).expect(403);
  });

  it('keeps listings, projects and members of other agencies out of reach', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const bListing = (await http().post('/v1/properties').set(b.h).send(draft()).expect(201)).body;
    const bProject = (
      await http()
        .post('/v1/projects')
        .set(b.h)
        .send({ name: 'Bravo Bay', emirate: 'Dubai' })
        .expect(201)
    ).body;

    await http().get(`/v1/properties/${bListing.id}`).set(a.h).expect(404);
    await http().patch(`/v1/properties/${bListing.id}`).set(a.h).send({ price: 1 }).expect(404);
    await http().post(`/v1/properties/${bListing.id}/permits`).set(a.h).send(permit).expect(404);
    await http()
      .post('/v1/properties')
      .set(a.h)
      .send(draft({ projectId: bProject.id }))
      .expect(404);
    await http()
      .post('/v1/properties')
      .set(a.h)
      .send(draft({ assignedMembershipId: b.membershipId }))
      .expect(404);
    expect((await http().get('/v1/properties').set(a.h).expect(200)).body.total).toBe(0);
    expect((await http().get('/v1/projects').set(a.h).expect(200)).body.data).toEqual([]);
  });

  it('lets managers delete any listing, live ones included, and agents only their drafts', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await t.owner.agencySettings.update({
      where: { tenantId: o.tenantId },
      data: { requirePermitToPublish: false },
    });
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const live = (await http().post('/v1/properties').set(agent.h).send(draft()).expect(201)).body;
    await http()
      .post(`/v1/properties/${live.id}/status`)
      .set(agent.h)
      .send({ status: 'active' })
      .expect(200);
    await http().delete(`/v1/properties/${live.id}`).set(agent.h).expect(403);
    await http().delete(`/v1/properties/${live.id}`).set(o.h).expect(204);
    await http().get(`/v1/properties/${live.id}`).set(o.h).expect(404);

    const agentDraft = (await http().post('/v1/properties').set(agent.h).send(draft()).expect(201))
      .body;
    await http().delete(`/v1/properties/${agentDraft.id}`).set(agent.h).expect(204);
    expect(await t.owner.property.count()).toBe(2);
  });

  it('unpublishes a live listing back to draft and publishes it again', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const p = (await http().post('/v1/properties').set(o.h).send(draft()).expect(201)).body;
    await http().post(`/v1/properties/${p.id}/permits`).set(o.h).send(permit).expect(201);
    const move = (status: string) =>
      http().post(`/v1/properties/${p.id}/status`).set(o.h).send({ status }).expect(200);
    await move('active');
    expect((await move('draft')).body.status).toBe('draft');
    expect((await move('active')).body.status).toBe('active');
  });

  it('accepts a permit document instead of a number, keeps it private, and renews permits', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Realty');
    const p = (await http().post('/v1/properties').set(o.h).send(draft()).expect(201)).body;
    const created = await http()
      .post(`/v1/properties/${p.id}/permits`)
      .set(o.h)
      .send({ authority: 'DLD', validUntil: '2099-12-31' })
      .expect(201);
    const permitId = created.body.id as string;
    expect(created.body.permitNumber).toBeNull();

    // Without its number or its document, the permit does not count yet.
    const blocked = await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(422);
    expect(blocked.body.errors.map((e: { path: string }) => e.path)).toEqual(['permits']);

    const docUrl = `/v1/properties/${p.id}/permits/${permitId}/document`;
    await http()
      .put(`${docUrl}?fileName=permit.html`)
      .set(o.h)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('<html><script>alert(1)</script></html>'))
      .expect(415);
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const saved = await http()
      .put(`${docUrl}?fileName=Trakheesi%20permit.pdf`)
      .set(o.h)
      .set('Content-Type', 'application/pdf')
      .send(pdf)
      .expect(200);
    expect(saved.body).toEqual({
      contentType: 'application/pdf',
      fileName: 'Trakheesi permit.pdf',
    });

    const file = await http().get(docUrl).set(o.h).buffer(true).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['content-disposition']).toContain('attachment');
    await http().get(docUrl).set(b.h).expect(404);
    await http()
      .put(`${docUrl}?fileName=x.pdf`)
      .set(b.h)
      .set('Content-Type', 'application/pdf')
      .send(pdf)
      .expect(404);

    const detail = await http().get(`/v1/properties/${p.id}`).set(o.h).expect(200);
    expect(detail.body.permits[0].document).toMatchObject({ fileName: 'Trakheesi permit.pdf' });
    await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(200);

    // The public listing never carries the document.
    await t.owner.agency.update({ where: { id: o.tenantId }, data: { status: 'active' } });
    const pub = await http().get(`/v1/public/listings/${p.id}`).expect(200);
    expect(JSON.stringify(pub.body)).not.toContain('Trakheesi permit.pdf');
    expect(pub.body.permit).toMatchObject({ authority: 'DLD', number: null });

    // An expired permit takes the listing off the portal; renewing it brings it back.
    await http()
      .patch(`/v1/properties/${p.id}/permits/${permitId}`)
      .set(o.h)
      .send({ validUntil: '2020-01-01' })
      .expect(200);
    await http().get(`/v1/public/listings/${p.id}`).expect(404);
    const renewed = await http()
      .patch(`/v1/properties/${p.id}/permits/${permitId}`)
      .set(o.h)
      .send({ validUntil: '2099-06-30', permitNumber: '7100099999' })
      .expect(200);
    expect(renewed.body.permitNumber).toBe('7100099999');
    await http().get(`/v1/public/listings/${p.id}`).expect(200);
  });
});

describe('dashboard summary', () => {
  it('counts listings by status, mine, and the team', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await t.owner.agencySettings.update({
      where: { tenantId: o.tenantId },
      data: { requirePermitToPublish: false, listingFreshnessDays: 2 },
    });
    await http()
      .post('/v1/invitations')
      .set(o.h)
      .send({ email: 'x@a.test', role: 'agent' })
      .expect(201);
    const p = (await http().post('/v1/properties').set(o.h).send(draft()).expect(201)).body;
    await http().post('/v1/properties').set(o.h).send(draft()).expect(201);
    await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(o.h)
      .send({ status: 'active' })
      .expect(200);

    const res = await http().get('/v1/dashboard/summary').set(o.h).expect(200);
    expect(res.body).toEqual({
      listings: {
        draft: 1,
        active: 1,
        underOffer: 0,
        sold: 0,
        rented: 0,
        archived: 0,
        mine: 2,
        needsVerification: 1,
      },
      team: { activeMembers: 1, pendingInvitations: 1 },
    });
  });
});
