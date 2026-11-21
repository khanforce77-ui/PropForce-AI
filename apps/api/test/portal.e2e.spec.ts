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
  it('emails the enquiry to the agent without exposing their email or numbers publicly', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    await http()
      .patch(`/v1/portal/agents/${a.membershipId}`)
      .set(a.h)
      .send({ whatsappE164: '055 111 2222', publicPhoneE164: '+971 4 123 4567' })
      .expect(200);

    // Nothing public carries the agent's phone, WhatsApp number or email address.
    const detail = await http().get(`/v1/public/listings/${p.id}`).expect(200);
    const search = await http().get('/v1/public/listings').expect(200);
    for (const body of [JSON.stringify(detail.body), JSON.stringify(search.body)]) {
      expect(body).not.toContain('a@example.test');
      expect(body).not.toMatch(/971(55111|41234)|111 ?2222|123 ?4567/);
    }
    expect(detail.body.agent).toMatchObject({ canCall: true, canWhatsapp: true });

    const before = t.emails.length;
    await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ fullName: 'Omar\r\nBcc: x@evil.test' }))
      .expect(202);
    const sent = t.emails.slice(before);
    expect(sent).toHaveLength(1);
    const enquiry = await t.owner.portalEnquiry.findFirstOrThrow();
    expect(sent[0]).toMatchObject({ to: 'a@example.test', replyTo: 'omar@example.test' });
    expect(sent[0]!.subject).toMatch(/^New enquiry: Omar Bcc: x@evil\.test about /);
    expect(sent[0]!.subject).not.toMatch(/[\r\n]/);
    expect(sent[0]!.text).toContain('+971507654321');
    expect(sent[0]!.text).toContain(`/app/${a.tenantId}/leads/${enquiry.leadId}`);

    // Without an email from the visitor there is no Reply-To.
    await t.owner.$executeRawUnsafe('TRUNCATE "public_rate_hit"');
    await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ phone: '050 111 0000', email: undefined }))
      .expect(202);
    expect(t.emails.at(-1)).toMatchObject({ to: 'a@example.test' });
    expect(t.emails.at(-1)!.replyTo).toBeUndefined();
  });

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

  it('turns an enquiry into a CRM lead for the listing agent, with the consent given', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a, {
      listingType: 'rent',
      rentPeriod: 'yearly',
      price: 150_000,
    });
    await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ consentMarketing: true }))
      .expect(202);

    const enquiry = await t.owner.portalEnquiry.findFirstOrThrow();
    expect(enquiry.leadId).toBeTruthy();
    const lead = await t.owner.lead.findUniqueOrThrow({
      where: { id: enquiry.leadId! },
      include: { contact: true, activities: true },
    });
    expect(lead).toMatchObject({
      tenantId: a.tenantId,
      intent: 'rent',
      source: 'portal',
      propertyId: p.id,
      assignedMembershipId: a.membershipId,
      communities: ['Dubai Marina'],
    });
    expect(lead.contact).toMatchObject({
      fullName: 'Omar Visitor',
      phoneE164: '+971507654321',
      source: 'portal',
      ownerMembershipId: a.membershipId,
    });
    expect(lead.activities.map((x) => x.type).sort()).toEqual(['created', 'note']);
    const consents = await t.owner.consentRecord.findMany({ where: { contactId: lead.contactId } });
    expect(consents).toHaveLength(6); // whatsapp, call, email × service, marketing
    expect(consents.every((c) => c.evidence === `portal_enquiry:${enquiry.id}`)).toBe(true);

    // The agent sees it as a lead through the normal CRM API.
    const leads = await http().get('/v1/leads').set(a.h).expect(200);
    expect(leads.body.data.map((l: { id: string }) => l.id)).toContain(lead.id);

    // A second enquiry from the same phone about the same listing adds to the same lead.
    await t.owner.$executeRawUnsafe('TRUNCATE "public_rate_hit"');
    await http()
      .post(`/v1/public/listings/${p.id}/enquiries`)
      .send(enquiryBody({ message: 'Any update on this one?' }))
      .expect(202);
    expect(await t.owner.lead.count()).toBe(1);
    expect(await t.owner.contact.count()).toBe(1);
    expect(await t.owner.leadActivity.count({ where: { type: 'note' } })).toBe(2);
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

describe('agent profile photos', () => {
  // A minimal valid PNG header is enough: the API checks bytes, it does not decode images.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('fake-image-body'),
  ]);
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

  it('lets an agent upload a photo that then shows on the public listing', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    let card = (await http().get('/v1/public/listings').expect(200)).body.data[0];
    expect(card.agent.photoVersion).toBeNull();

    await http()
      .put(`/v1/portal/agents/${a.membershipId}/photo`)
      .set(a.h)
      .send({ image: dataUrl })
      .expect(200);
    const mine = await http().get(`/v1/portal/agents/${a.membershipId}/photo`).set(a.h).expect(200);
    expect(mine.body.photo.dataUrl).toBe(dataUrl);

    card = (await http().get('/v1/public/listings').expect(200)).body.data[0];
    expect(card.agent.photoVersion).toMatch(/^[0-9a-f]{16}$/);
    const detail = await http().get(`/v1/public/listings/${p.id}`).expect(200);
    expect(detail.body.agent.photoVersion).toBe(card.agent.photoVersion);

    const img = await http().get(`/v1/public/agents/${a.membershipId}/photo`).expect(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('immutable');
    expect(Buffer.from(img.body as Buffer).equals(png)).toBe(true);

    await http().delete(`/v1/portal/agents/${a.membershipId}/photo`).set(a.h).expect(204);
    await http().get(`/v1/public/agents/${a.membershipId}/photo`).expect(404);
  });

  it('refuses non-images and other agencies, and hides photos of suspended agencies', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    await http()
      .put(`/v1/portal/agents/${a.membershipId}/photo`)
      .set(a.h)
      .send({ image: `data:image/png;base64,${Buffer.from('<svg onload=x>').toString('base64')}` })
      .expect(400);
    await http()
      .put(`/v1/portal/agents/${a.membershipId}/photo`)
      .set(b.h)
      .send({ image: dataUrl })
      .expect(404);
    await http()
      .put(`/v1/portal/agents/${a.membershipId}/photo`)
      .set(a.h)
      .send({ image: dataUrl })
      .expect(200);
    await http().get(`/v1/public/agents/${a.membershipId}/photo`).expect(200);
    await t.owner.agency.update({ where: { id: a.tenantId }, data: { status: 'suspended' } });
    await http().get(`/v1/public/agents/${a.membershipId}/photo`).expect(404);
  });
});

describe('public portal: Bayut-style discovery and trust', () => {
  it('filters by bathrooms, amenity and agent, and lists amenities in the facets', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    await publishedListing(a, { bathrooms: 1, amenities: ['Pool', 'Gym'] });
    await publishedListing(a, { bathrooms: 4, amenities: ['Pool'] });
    await publishedListing(b, { bathrooms: 2 });

    const q = async (query: Record<string, string>) =>
      (await http().get('/v1/public/listings').query(query).expect(200)).body.total as number;
    expect(await q({ baths: '2' })).toBe(2);
    expect(await q({ amenity: 'Pool' })).toBe(2);
    expect(await q({ amenity: 'Gym' })).toBe(1);
    expect(await q({ agent: b.membershipId })).toBe(1);
    await http().get('/v1/public/listings').query({ agent: 'not-a-uuid' }).expect(400);

    const facets = (await http().get('/v1/public/facets').expect(200)).body;
    expect(facets.amenities).toEqual([
      { name: 'Pool', count: 2 },
      { name: 'Gym', count: 1 },
    ]);
  });

  it('shows only an approximate location, coarser for villas', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const flat = await publishedListing(a, { latitude: 25.080123, longitude: 55.140987 });
    const villa = await publishedListing(a, {
      propertyType: 'villa',
      latitude: 25.051234,
      longitude: 55.261234,
    });
    const none = await publishedListing(a);

    const f = (await http().get(`/v1/public/listings/${flat.id}`).expect(200)).body;
    expect(f.location).toEqual({ lat: 25.08, lng: 55.141, radiusM: 150 });
    expect(JSON.stringify(f)).not.toContain('25.080123');
    const v = (await http().get(`/v1/public/listings/${villa.id}`).expect(200)).body;
    expect(v.location).toEqual({ lat: 25.05, lng: 55.26, radiusM: 1000 });
    expect(
      (await http().get(`/v1/public/listings/${none.id}`).expect(200)).body.location,
    ).toBeNull();
    // Cards never carry coordinates.
    const cards = JSON.stringify((await http().get('/v1/public/listings').expect(200)).body);
    expect(cards).not.toContain('55.14');
  });

  it('suggests similar listings: same purpose and type, same community first, never itself', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const base = await publishedListing(a);
    const sameArea = await publishedListing(a);
    const otherArea = await publishedListing(a, { community: 'JVC' });
    await publishedListing(a, { propertyType: 'villa' });
    await publishedListing(a, { listingType: 'rent', rentPeriod: 'yearly', price: 100_000 });

    const res = await http().get(`/v1/public/listings/${base.id}/similar`).expect(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([sameArea.id, otherArea.id]);
    await http()
      .get('/v1/public/listings/00000000-0000-4000-8000-000000000000/similar')
      .expect(404);
  });

  it('serves a public agent profile without contact details, only while they have live listings', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    await http()
      .patch(`/v1/portal/agents/${a.membershipId}`)
      .set(a.h)
      .send({ publicPhoneE164: '+971501234567', brn: '12345' })
      .expect(200);
    await publishedListing(a);
    await publishedListing(a, {
      listingType: 'rent',
      rentPeriod: 'yearly',
      price: 100_000,
      community: 'JVC',
    });

    const res = await http().get(`/v1/public/agents/${a.membershipId}`).expect(200);
    expect(res.body).toMatchObject({
      id: a.membershipId,
      name: 'Alpha Homes Agent',
      brn: '12345',
      canCall: true,
      agency: { name: 'Alpha Homes' },
      listings: { sale: 1, rent: 1, total: 2 },
    });
    expect(res.body.communities.sort()).toEqual(['Dubai Marina', 'JVC']);
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('501234567');
    expect(json).not.toContain('a@example.test');

    await t.owner.property.updateMany({
      where: { tenantId: a.tenantId },
      data: { status: 'draft' },
    });
    await http().get(`/v1/public/agents/${a.membershipId}`).expect(404);
  });

  it('files listing reports under the agency, once per visitor, and never for hidden listings', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a);
    const hidden = await publishedListing(a, { status: 'draft' });
    const send = (id: string, body: Record<string, unknown>) =>
      http()
        .post(`/v1/public/listings/${id}/reports`)
        .set('x-portal-key', PORTAL_KEY)
        .set('x-portal-client-ip', '203.0.113.9')
        .send(body);

    await send(p.id, {
      reason: 'not_available',
      details: 'Agent said it was sold',
      email: '',
    }).expect(202);
    await send(p.id, { reason: 'fraud' }).expect(429);
    await send(p.id, { reason: 'made_up' }).expect(400);
    await send(hidden.id, { reason: 'fraud' }).expect(404);

    const rows = await t.owner.portalListingReport.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: a.tenantId,
      propertyId: p.id,
      reason: 'not_available',
      details: 'Agent said it was sold',
      email: null,
      status: 'open',
    });
    expect(rows[0]!.ipHash).not.toContain('203.0.113.9');

    // Honeypot: accepted, nothing stored.
    await http()
      .post(`/v1/public/listings/${p.id}/reports`)
      .send({ reason: 'fraud', website: 'spam.example' })
      .expect(202);
    expect(await t.owner.portalListingReport.count()).toBe(1);
  });

  it('shows the permit QR link, which must be an https .gov.ae address', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p = await publishedListing(a, {}, { permit: false });
    const permits = `/v1/properties/${p.id}/permits`;
    const validUntil = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10);
    for (const bad of [
      'http://dubailand.gov.ae/x',
      'https://evil.example/gov.ae',
      'https://gov.ae.evil.test/',
    ]) {
      await http()
        .post(permits)
        .set(a.h)
        .send({ authority: 'DLD', permitNumber: '711', validUntil, verificationUrl: bad })
        .expect(400);
    }
    const permit = await http()
      .post(permits)
      .set(a.h)
      .send({
        authority: 'DLD',
        validUntil,
        verificationUrl: 'https://Trakheesi.DubaiLand.gov.ae/verify?id=711',
      })
      .expect(201);

    const card = (await http().get('/v1/public/listings').expect(200)).body.data[0];
    expect(card.permit).toEqual({
      authority: 'DLD',
      number: null,
      validUntil,
      verificationUrl: 'https://trakheesi.dubailand.gov.ae/verify?id=711',
    });

    await http()
      .patch(`${permits}/${permit.body.id as string}`)
      .set(a.h)
      .send({ verificationUrl: null })
      .expect(200);
    const after = (await http().get(`/v1/public/listings/${p.id}`).expect(200)).body;
    expect(after.permit.verificationUrl).toBeNull();
  });
});

describe('public portal: saved listings and new projects', () => {
  it('fetches saved listings by id, skipping hidden ones, and refuses bad ids', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const p1 = await publishedListing(a);
    const p2 = await publishedListing(a);
    const hidden = await publishedListing(a, { status: 'draft' });
    await publishedListing(a);

    const res = await http()
      .get('/v1/public/listings')
      .query({ ids: `${p1.id},${p2.id},${hidden.id}` })
      .expect(200);
    expect(res.body.data.map((r: { id: string }) => r.id).sort()).toEqual([p1.id, p2.id].sort());
    await http().get('/v1/public/listings').query({ ids: 'nope' }).expect(400);
  });

  it('shows the off-plan project name and handover, filters by project, sorts by handover', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const vista = await t.owner.project.create({
      data: { tenantId: a.tenantId, name: 'Marina Vista', emirate: 'Dubai' },
    });
    const late = await publishedListing(a, {
      completion: 'off_plan',
      projectId: vista.id,
      handoverDate: new Date('2029-03-31'),
    });
    const soon = await publishedListing(a, {
      completion: 'off_plan',
      projectId: vista.id,
      handoverDate: new Date('2027-09-30'),
    });
    await publishedListing(a);

    const res = await http()
      .get('/v1/public/listings')
      .query({ completion: 'off_plan', sort: 'handover' })
      .expect(200);
    expect(res.body.data.map((r: { id: string }) => r.id)).toEqual([soon.id, late.id]);
    expect(res.body.data[0]).toMatchObject({ project: 'Marina Vista', handoverDate: '2027-09-30' });
    expect(
      (await http().get('/v1/public/listings').query({ project: 'marina vista' }).expect(200)).body
        .total,
    ).toBe(2);
    const detail = (await http().get(`/v1/public/listings/${soon.id}`).expect(200)).body;
    expect(detail.project).toBe('Marina Vista');
  });
});

describe('listing reports: agency and platform screens', () => {
  it('shows reports to the listing agency only, lets it close them, and lists all for admins', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    const pa = await publishedListing(a);
    const pb = await publishedListing(b);
    const report = (id: string, ip: string, reason: string) =>
      http()
        .post(`/v1/public/listings/${id}/reports`)
        .set('x-portal-key', PORTAL_KEY)
        .set('x-portal-client-ip', ip)
        .send({ reason, details: 'Sold last week', email: 'v@example.test' })
        .expect(202);
    await report(pa.id, '203.0.113.1', 'not_available');
    await report(pa.id, '203.0.113.2', 'wrong_price');
    await report(pb.id, '203.0.113.1', 'fraud');

    const list = await http().get('/v1/portal/reports').set(a.h).expect(200);
    expect(list.body).toMatchObject({ total: 2, open: 2 });
    expect(list.body.data.every((r: { property: { id: string } }) => r.property.id === pa.id)).toBe(
      true,
    );
    expect(JSON.stringify(list.body)).not.toContain('ipHash');

    const id = list.body.data[0].id as string;
    await http()
      .post(`/v1/portal/reports/${id}/status`)
      .set(a.h)
      .send({ status: 'resolved' })
      .expect(200);
    const after = await http()
      .get('/v1/portal/reports')
      .set(a.h)
      .query({ status: 'open' })
      .expect(200);
    expect(after.body).toMatchObject({ total: 1, open: 1 });
    // Another agency cannot see or change it.
    await http()
      .post(`/v1/portal/reports/${id}/status`)
      .set(b.h)
      .send({ status: 'dismissed' })
      .expect(404);
    expect((await http().get('/v1/portal/reports').set(b.h).expect(200)).body.total).toBe(1);

    await t.owner.user.update({ where: { id: b.userId }, data: { isPlatformAdmin: true } });
    const admin = await http()
      .get('/v1/platform/listing-reports')
      .set({ Authorization: b.h.Authorization! })
      .expect(200);
    expect(admin.body.data).toHaveLength(3);
    expect(admin.body.data.map((r: { agency: { name: string } }) => r.agency.name).sort()).toEqual([
      'Alpha Homes',
      'Alpha Homes',
      'Bravo Realty',
    ]);
    await http()
      .get('/v1/platform/listing-reports')
      .set({ Authorization: a.h.Authorization! })
      .expect(403);
  });
});
