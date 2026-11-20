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
const DAY = 86_400_000;
const PORTAL_KEY = 'k'.repeat(40);

beforeAll(async () => {
  t = await createTestApp({
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    PORTAL_PUBLIC_URL: 'https://portal.example.test',
    PORTAL_API_KEY: PORTAL_KEY,
  });
  app = t.app;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.owner);
  await t.owner.$executeRawUnsafe('TRUNCATE "public_rate_hit"');
  resetRateLimits(app);
  t.emails.length = 0;
});

interface Agency {
  tenantId: string;
  membershipId: string;
  userId: string;
  h: Record<string, string>;
}

async function createAgency(email: string, name: string): Promise<Agency> {
  const body = registration({
    email,
    fullName: `${name} Agent`,
    agency: { name, emirate: 'Dubai' },
  });
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const login = await http()
    .post('/v1/auth/login')
    .send({ email, password: body.password })
    .expect(200);
  const auth = { Authorization: `Bearer ${login.body.accessToken as string}` };
  const setup = await http().post('/v1/me/mfa/totp/setup').set(auth).expect(200);
  const code = new TOTP({
    secret: Secret.fromBase32(setup.body.secret),
    digits: 6,
    period: 30,
  }).generate();
  await http().post('/v1/me/mfa/totp/confirm').set(auth).send({ code }).expect(200);
  const me = await http().get('/v1/me').set(auth).expect(200);
  const m = me.body.memberships[0];
  await t.owner.agency.update({ where: { id: m.agency.id }, data: { status: 'active' } });
  return {
    tenantId: m.agency.id,
    membershipId: m.id,
    userId: me.body.user.id,
    h: { ...auth, 'X-Tenant-Id': m.agency.id },
  };
}

async function publishedListing(
  a: Agency,
  overrides: Record<string, unknown> = {},
  opts: { permit?: boolean } = {},
) {
  const p = await t.owner.property.create({
    data: {
      tenantId: a.tenantId,
      reference: `REF-${Math.random().toString(36).slice(2, 8)}`,
      listingType: 'sale',
      propertyType: 'apartment',
      emirate: 'Dubai',
      community: 'Dubai Marina',
      building: 'Marina Gate 1',
      unitNo: '2304',
      floor: 23,
      title: '2BR with sea view',
      bedrooms: 2,
      bathrooms: 3,
      areaSqft: 1200,
      price: 2_400_000,
      status: 'active',
      listingExpiresAt: new Date(Date.now() + 14 * DAY),
      verifiedAt: new Date(),
      assignedMembershipId: a.membershipId,
      createdBy: a.userId,
      ...overrides,
    },
  });
  if (opts.permit !== false) {
    await t.owner.propertyPermit.create({
      data: {
        tenantId: a.tenantId,
        propertyId: p.id,
        authority: 'DLD',
        permitNumber: `7${Math.floor(Math.random() * 1e9)}`,
        validUntil: new Date(Date.now() + 60 * DAY),
      },
    });
  }
  return p;
}

const enquiryBody = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Omar Visitor',
  phone: '050 765 4321',
  email: 'omar@example.test',
  message: 'Is this still available? Can I view it this weekend?',
  consentContact: true,
  consentMarketing: false,
  website: '',
  elapsedMs: 15_000,
  ...overrides,
});

describe('public portal: listings', () => {
  it('lists only public listings from all agencies, without private fields', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    const pa = await publishedListing(a);
    const pb = await publishedListing(b, {
      listingType: 'rent',
      rentPeriod: 'yearly',
      price: 120_000,
    });
    await publishedListing(a, { status: 'draft' });
    await publishedListing(a, {}, { permit: false });

    const res = await http().get('/v1/public/listings').expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.data.map((r: { id: string }) => r.id).sort()).toEqual([pa.id, pb.id].sort());
    const card = res.body.data.find((r: { id: string }) => r.id === pa.id);
    expect(card.agent).toMatchObject({ name: 'Alpha Homes Agent', canCall: false });
    expect(card.agency).toMatchObject({ name: 'Alpha Homes' });
    expect(card.permit).toMatchObject({ authority: 'DLD' });
    const json = JSON.stringify(res.body);
    for (const secret of ['2304', 'unitNo', 'floor', 'createdBy', 'a@example.test', 'tenantId']) {
      expect(json).not.toContain(secret);
    }
    expect(res.headers['cache-control']).toContain('public');
  });

  it('filters by purpose, type, community, price, bedrooms and agency', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    await publishedListing(a);
    await publishedListing(a, {
      propertyType: 'villa',
      community: 'Arabian Ranches',
      bedrooms: 4,
      price: 5_000_000,
    });
    await publishedListing(b, {
      listingType: 'rent',
      rentPeriod: 'yearly',
      price: 90_000,
      bedrooms: 0,
    });

    const q = async (query: Record<string, string>) =>
      (await http().get('/v1/public/listings').query(query).expect(200)).body.total as number;
    expect(await q({ purpose: 'rent' })).toBe(1);
    expect(await q({ type: 'villa' })).toBe(1);
    expect(await q({ community: 'arabian ranches' })).toBe(1);
    expect(await q({ minPrice: '1000000', maxPrice: '3000000' })).toBe(1);
    expect(await q({ beds: '0' })).toBe(1);
    expect(await q({ q: 'ranches' })).toBe(1);
    const slug = (await t.owner.agency.findUniqueOrThrow({ where: { id: b.tenantId } })).slug;
    expect(await q({ agency: slug })).toBe(1);
    await http().get('/v1/public/listings').query({ secret: '1' }).expect(400);
  });

  it('serves a listing page, and 404 once it is unpublished or the agency is suspended', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    const res = await http().get(`/v1/public/listings/${p.id}`).expect(200);
    expect(res.body).toMatchObject({ id: p.id, building: 'Marina Gate 1', price: 2_400_000 });
    expect(res.body.unitNo).toBeUndefined();

    await t.owner.agency.update({ where: { id: a.tenantId }, data: { status: 'suspended' } });
    await http().get(`/v1/public/listings/${p.id}`).expect(404);
    expect((await http().get('/v1/public/listings').expect(200)).body.total).toBe(0);
  });

  it('returns facets for the filters', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    await publishedListing(a);
    await publishedListing(a, { community: 'JVC' });
    const res = await http().get('/v1/public/facets').expect(200);
    expect(res.body.communities).toHaveLength(2);
    expect(res.body.types).toEqual([{ type: 'apartment', count: 2 }]);
  });
});

describe('public portal: contacting the agent', () => {
  it('records a WhatsApp click and returns a wa.me link to the assigned agent', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    await http()
      .post(`/v1/public/listings/${p.id}/contact`)
      .send({ channel: 'whatsapp' })
      .expect(409);

    await http()
      .patch(`/v1/portal/agents/${a.membershipId}`)
      .set(a.h)
      .send({ whatsappE164: '055 111 2222', publicPhoneE164: '+971 4 123 4567' })
      .expect(200);

    const wa = await http()
      .post(`/v1/public/listings/${p.id}/contact`)
      .send({ channel: 'whatsapp' })
      .expect(200);
    expect(wa.body.href).toMatch(/^https:\/\/wa\.me\/971551112222\?text=/);
    expect(decodeURIComponent(wa.body.href)).toContain(
      `https://portal.example.test/property/${p.id}`,
    );
    const call = await http()
      .post(`/v1/public/listings/${p.id}/contact`)
      .send({ channel: 'call' })
      .expect(200);
    expect(call.body.href).toBe('tel:+97141234567');
    // A repeat click within ten minutes is not counted twice.
    await http().post(`/v1/public/listings/${p.id}/contact`).send({ channel: 'call' }).expect(200);

    const events = await t.owner.portalContactEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.channel)).toEqual(['whatsapp', 'call']);
    expect(events[0]).toMatchObject({ tenantId: a.tenantId, membershipId: a.membershipId });

    const agents = await http().get('/v1/portal/agents').set(a.h).expect(200);
    expect(agents.body.data[0].last30Days).toEqual({
      enquiries: 0,
      whatsappClicks: 1,
      callClicks: 1,
    });
  });

  it('rejects invalid phone numbers on the profile', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    await http()
      .patch(`/v1/portal/agents/${a.membershipId}`)
      .set(a.h)
      .send({ whatsappE164: '12345' })
      .expect(400);
  });

  it('does not let one agency edit another agency agent', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    await http()
      .patch(`/v1/portal/agents/${b.membershipId}`)
      .set(a.h)
      .send({ whatsappE164: '055 111 2222' })
      .expect(404);
  });
});

describe('public portal: enquiries', () => {
  it('stores an enquiry with consent for the listing agent only', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    const p = await publishedListing(a);
    const res = await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ consentMarketing: true }))
      .expect(202);
    expect(res.body).toEqual({ status: 'received' });

    const mine = await http().get('/v1/portal/enquiries').set(a.h).expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.data[0]).toMatchObject({
      fullName: 'Omar Visitor',
      phoneE164: '+971507654321',
      status: 'new',
      consentMarketing: true,
      property: { id: p.id },
      agent: { id: a.membershipId },
    });
    const row = await t.owner.portalEnquiry.findFirstOrThrow();
    expect(row.consentText).toContain('I agree');
    expect(row.ipHash).toBeTruthy();

    const theirs = await http().get('/v1/portal/enquiries').set(b.h).expect(200);
    expect(theirs.body.total).toBe(0);
    await http()
      .post(`/v1/portal/enquiries/${row.id}/status`)
      .set(b.h)
      .send({ status: 'spam' })
      .expect(404);
    await http()
      .post(`/v1/portal/enquiries/${row.id}/status`)
      .set(a.h)
      .send({ status: 'contacted' })
      .expect(200);
  });

  it('requires consent and a valid phone', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ consentContact: false }))
      .expect(400);
    await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ phone: '123' }))
      .expect(400);
    expect(await t.owner.portalEnquiry.count()).toBe(0);
  });

  it('silently drops bot submissions and blocks repeats and floods', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    const url = `/v1/public/listings/${p.id}/enquiries`;
    await http()
      .post(url)
      .send(enquiryBody({ website: 'http://spam' }))
      .expect(202);
    await http()
      .post(url)
      .send(enquiryBody({ elapsedMs: 300 }))
      .expect(202);
    expect(await t.owner.portalEnquiry.count()).toBe(0);

    await http().post(url).send(enquiryBody()).expect(202);
    await http().post(url).send(enquiryBody()).expect(429);

    // Many different phones from one visitor IP hit the per-IP cap.
    const headers = { 'x-portal-key': PORTAL_KEY, 'x-portal-client-ip': '203.0.113.9' };
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await http()
        .post(url)
        .set(headers)
        .send(enquiryBody({ phone: `+97150000000${i}` }));
      codes.push(r.status);
    }
    expect(codes.filter((c) => c === 202)).toHaveLength(8);
    expect(codes.slice(-2)).toEqual([429, 429]);
  });

  it('refuses enquiries for hidden listings', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a, { status: 'draft' });
    await http().post(`/v1/public/listings/${p.id}/enquiries`).send(enquiryBody()).expect(404);
  });
});
