import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actors, type Headers, type Owner } from './actors';
import { createTestApp, resetDatabase, resetRateLimits, type TestApp } from './helpers';

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const { createOwner: signUp, inviteNew, listing } = actors(() => t);

/** An onboarded (active) agency, so its listings can reach the public portal. */
async function createOwner(email: string, name: string): Promise<Owner> {
  const o = await signUp(email, name);
  await t.owner.agency.update({ where: { id: o.tenantId }, data: { status: 'active' } });
  return o;
}

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

const pdf = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n% test card\n%%EOF').toString('base64')}`;

async function setReview(enabled: boolean) {
  await t.owner.featureFlag.update({
    where: { key: 'platform.require_listing_review' },
    data: { enabled },
  });
}

async function platformAdmin(): Promise<Owner> {
  const admin = await createOwner('admin@propforce.test', 'PropForce Ops');
  await t.owner.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
  return admin;
}

async function draft(h: Headers, overrides: Record<string, unknown> = {}) {
  return listing(h, overrides, { draft: true });
}

const publicIds = async () =>
  ((await http().get('/v1/public/listings').expect(200)).body.data as { id: string }[]).map(
    (r) => r.id,
  );

describe('listing review', () => {
  it('keeps a new agency’s listing off the portal until PropForce approves it', async () => {
    await setReview(true);
    const admin = await platformAdmin();
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');

    const p = await listing(a.h);
    const detail = await http().get(`/v1/properties/${p.id}`).set(a.h).expect(200);
    expect(detail.body).toMatchObject({ status: 'active', reviewStatus: 'pending' });
    expect(
      detail.body.qualityChecks.find((c: { key: string }) => c.key === 'permit'),
    ).toMatchObject({ ok: true, required: true });
    expect(await publicIds()).not.toContain(p.id);

    // Only platform admins see the queue.
    await http().get('/v1/platform/listing-reviews').set(a.auth).expect(403);
    const queue = await http().get('/v1/platform/listing-reviews').set(admin.auth).expect(200);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0]).toMatchObject({ id: p.id, agency: { name: 'Alpha Realty' } });
    expect(queue.body.data[0].checks.map((c: { key: string }) => c.key)).toContain('photos');

    // Rejecting needs a reason and sends the listing back to draft.
    await http()
      .post(`/v1/platform/listings/${p.id}/review`)
      .set(admin.auth)
      .send({ decision: 'reject' })
      .expect(400);
    const rejected = await http()
      .post(`/v1/platform/listings/${p.id}/review`)
      .set(admin.auth)
      .send({ decision: 'reject', reason: 'Photos do not match the permit unit' })
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'draft', reviewStatus: 'rejected' });
    const seen = await http().get(`/v1/properties/${p.id}`).set(a.h).expect(200);
    expect(seen.body.reviewReason).toBe('Photos do not match the permit unit');

    // Publishing again asks for a new review; approval puts it on the portal.
    await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(a.h)
      .send({ status: 'active' })
      .expect(200);
    expect((await http().get(`/v1/properties/${p.id}`).set(a.h)).body.reviewStatus).toBe('pending');
    await http()
      .post(`/v1/platform/listings/${p.id}/review`)
      .set(admin.auth)
      .send({ decision: 'approve' })
      .expect(200);
    expect(await publicIds()).toContain(p.id);
    await http()
      .post(`/v1/platform/listings/${p.id}/review`)
      .set(admin.auth)
      .send({ decision: 'approve' })
      .expect(409);

    // A reported listing can be taken off the portal for another look.
    await http()
      .post(`/v1/platform/listings/${p.id}/review`)
      .set(admin.auth)
      .send({ decision: 'send_back', reason: 'Visitor reported it as sold' })
      .expect(200);
    expect(await publicIds()).not.toContain(p.id);

    const log = await t.owner.auditLog.findMany({
      where: { tenantId: a.tenantId, action: { startsWith: 'property.review_' } },
      orderBy: { createdAt: 'asc' },
    });
    expect(log.map((l) => [l.action, l.actorType])).toEqual([
      ['property.review_rejected', 'platform'],
      ['property.review_approved', 'platform'],
      ['property.review_reopened', 'platform'],
    ]);
  });

  it('skips review when the setting is off and for agencies with 10 approved listings', async () => {
    await setReview(false);
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const p = await listing(a.h);
    expect((await http().get(`/v1/properties/${p.id}`).set(a.h)).body.reviewStatus).toBe(
      'not_required',
    );
    expect(await publicIds()).toContain(p.id);

    await setReview(true);
    for (let i = 0; i < 10; i++) {
      const x = await draft(a.h);
      await t.owner.property.update({ where: { id: x.id }, data: { reviewStatus: 'approved' } });
    }
    const trusted = await listing(a.h);
    expect((await http().get(`/v1/properties/${trusted.id}`).set(a.h)).body.reviewStatus).toBe(
      'not_required',
    );
  });
});

describe('permit checks', () => {
  it('refuses a permit for the other purpose and a permit another agency already uses', async () => {
    await setReview(false);
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const b = await createOwner('owner@bravo.test', 'Bravo Homes');

    const sale = await draft(a.h);
    await http()
      .post(`/v1/properties/${sale.id}/permits`)
      .set(a.h)
      .send({
        authority: 'DLD',
        purpose: 'rent',
        permitNumber: '7100099001',
        validUntil: '2099-12-31',
      })
      .expect(201);
    const blocked = await http()
      .post(`/v1/properties/${sale.id}/status`)
      .set(a.h)
      .send({ status: 'active' })
      .expect(422);
    expect(blocked.body.errors[0].message).toMatch(/permit is for rent/);

    // Without a purpose, the permit takes the listing's own type.
    const p = await draft(a.h);
    const permit = await http()
      .post(`/v1/properties/${p.id}/permits`)
      .set(a.h)
      .send({ authority: 'DLD', permitNumber: '7100099002', validUntil: '2099-12-31' })
      .expect(201);
    expect(permit.body.purpose).toBe('sale');
    await http()
      .post(`/v1/properties/${p.id}/status`)
      .set(a.h)
      .send({ status: 'active' })
      .expect(200);

    // Bravo cannot advertise with Alpha's permit number.
    const copy = await draft(b.h);
    const dup = await http()
      .post(`/v1/properties/${copy.id}/permits`)
      .set(b.h)
      .send({ authority: 'DLD', permitNumber: '7100099002', validUntil: '2099-12-31' })
      .expect(409);
    expect(dup.body.code).toBe('PERMIT_IN_USE');
    // ...nor by renaming another permit to it.
    const own = await http()
      .post(`/v1/properties/${copy.id}/permits`)
      .set(b.h)
      .send({ authority: 'DLD', permitNumber: '7100099003', validUntil: '2099-12-31' })
      .expect(201);
    await http()
      .patch(`/v1/properties/${copy.id}/permits/${own.body.id as string}`)
      .set(b.h)
      .send({ permitNumber: '7100099002' })
      .expect(409);

    // An expired permit elsewhere does not block the number, and Bravo never saw Alpha's row.
    await t.owner.propertyPermit.updateMany({
      where: { permitNumber: '7100099002' },
      data: { validUntil: new Date('2020-01-01') },
    });
    await http()
      .post(`/v1/properties/${copy.id}/permits`)
      .set(b.h)
      .send({ authority: 'Trakheesi', permitNumber: '7100099002', validUntil: '2099-12-31' })
      .expect(201);
    const bView = await http().get(`/v1/properties/${copy.id}`).set(b.h).expect(200);
    expect(bView.body.permits).toHaveLength(2);
  });
});

describe('verified agent', () => {
  it('lets an agent send their broker card and shows the badge once PropForce approves', async () => {
    await setReview(false);
    const admin = await platformAdmin();
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const agent = await inviteNew(a, 'agent@alpha.test', 'agent');
    const p = await listing(agent.h);
    const path = `/v1/portal/agents/${agent.membershipId}/verification`;

    const body = { brn: '45678', brnExpiresAt: '2099-01-31', card: pdf, emiratesId: pdf };
    // Agents send their own; the owner (a manager) may send for them, another agent may not.
    const other = await inviteNew(a, 'other@alpha.test', 'agent');
    await http().post(path).set(other.h).send(body).expect(403);
    await http()
      .post(path)
      .set(agent.h)
      .send({ ...body, brnExpiresAt: '2020-01-01' })
      .expect(400);
    await http()
      .post(path)
      .set(agent.h)
      .send({ ...body, card: 'data:text/html;base64,PGgxPg==' })
      .expect(400);
    await http().post(path).set(agent.h).send(body).expect(201);
    expect((await http().get(path).set(agent.h).expect(200)).body).toMatchObject({
      verified: false,
      request: { status: 'pending', brn: '45678' },
    });

    const queue = await http().get('/v1/platform/broker-verifications').set(admin.auth).expect(200);
    expect(queue.body.data).toHaveLength(1);
    const id = queue.body.data[0].id as string;
    expect(queue.body.data[0]).not.toHaveProperty('cardBytes');
    const card = await http()
      .get(`/v1/platform/broker-verifications/${id}/card`)
      .set(admin.auth)
      .expect(200);
    expect(card.headers['content-type']).toBe('application/pdf');
    await http().get(`/v1/platform/broker-verifications/${id}/card`).set(a.auth).expect(403);

    await http()
      .post(`/v1/platform/broker-verifications/${id}/decision`)
      .set(admin.auth)
      .send({ decision: 'approve' })
      .expect(200);
    // The Emirates ID copy is gone once decided.
    await http()
      .get(`/v1/platform/broker-verifications/${id}/emirates-id`)
      .set(admin.auth)
      .expect(404);
    const row = await t.owner.brokerVerification.findUniqueOrThrow({ where: { id } });
    expect(row.emiratesIdBytes).toBeNull();

    expect((await http().get(path).set(agent.h).expect(200)).body).toMatchObject({
      verified: true,
      brn: '45678',
    });
    const pub = await http().get(`/v1/public/listings/${p.id}`).expect(200);
    expect(pub.body.agent).toMatchObject({ brn: '45678', verified: true });
  });

  it('shows the reason when PropForce rejects the card', async () => {
    const admin = await platformAdmin();
    const a = await createOwner('owner@alpha.test', 'Alpha Realty');
    const path = `/v1/portal/agents/${a.membershipId}/verification`;
    await http()
      .post(path)
      .set(a.h)
      .send({ brn: '11111', brnExpiresAt: '2099-01-31', card: pdf, emiratesId: pdf })
      .expect(201);
    const [v] = (await http().get('/v1/platform/broker-verifications').set(admin.auth)).body.data;
    await http()
      .post(`/v1/platform/broker-verifications/${v.id as string}/decision`)
      .set(admin.auth)
      .send({ decision: 'reject' })
      .expect(400);
    await http()
      .post(`/v1/platform/broker-verifications/${v.id as string}/decision`)
      .set(admin.auth)
      .send({ decision: 'reject', reason: 'Name on the card does not match the account' })
      .expect(200);
    expect((await http().get(path).set(a.h).expect(200)).body).toMatchObject({
      verified: false,
      request: { status: 'rejected', reason: 'Name on the card does not match the account' },
    });
  });
});
