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
import { withTenant } from '@propforce/db';
import { mayContact } from '../src/crm/consent';
import { PRISMA } from '../src/database/database.module';

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

const contact = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Fatima Buyer',
  phone: '050 123 4567',
  email: 'fatima@example.test',
  source: 'referral',
  ...overrides,
});

describe('contacts', () => {
  it('normalises UAE phone numbers, records consent given at capture and audits it', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const res = await http()
      .post('/v1/contacts')
      .set(o.h)
      .send(
        contact({
          consents: [{ channel: 'whatsapp', purpose: 'service', method: 'asked on call' }],
        }),
      )
      .expect(201);
    expect(res.body).toMatchObject({
      phoneE164: '+971501234567',
      ownerMembershipId: o.membershipId,
    });
    const detail = await http().get(`/v1/contacts/${res.body.id}`).set(o.h).expect(200);
    const state = (channel: string, purpose: string) =>
      detail.body.consentState.find(
        (c: { channel: string; purpose: string }) => c.channel === channel && c.purpose === purpose,
      ).status;
    expect(state('whatsapp', 'service')).toBe('granted');
    expect(state('whatsapp', 'marketing')).toBe('unknown');
    const logs = await http().get('/v1/audit-logs?entityType=contact').set(o.h).expect(200);
    expect(logs.body.data[0]).toMatchObject({ action: 'contact.created' });
  });

  it('rejects duplicates, bad numbers and contacts with no way to reach them', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await http().post('/v1/contacts').set(o.h).send(contact()).expect(201);
    const dup = await http()
      .post('/v1/contacts')
      .set(o.h)
      .send(contact({ phone: '+971 50 123 4567', email: null }))
      .expect(409);
    expect(dup.body.code).toBe('CONTACT_EXISTS');
    await http()
      .post('/v1/contacts')
      .set(o.h)
      .send(contact({ phone: '12' }))
      .expect(400);
    await http()
      .post('/v1/contacts')
      .set(o.h)
      .send({ fullName: 'Nobody', phone: null, email: null })
      .expect(400);
  });

  it('withdrawing consent is recorded as history and becomes the current state', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const c = await http()
      .post('/v1/contacts')
      .set(o.h)
      .send(
        contact({
          consents: [{ channel: 'whatsapp', purpose: 'marketing', method: 'web form' }],
        }),
      )
      .expect(201);
    await http()
      .post(`/v1/contacts/${c.body.id}/consents`)
      .set(o.h)
      .send({
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'withdrawn',
        method: 'replied STOP',
      })
      .expect(201);
    const detail = await http().get(`/v1/contacts/${c.body.id}`).set(o.h).expect(200);
    expect(detail.body.consents).toHaveLength(2);
    const wa = detail.body.consentState.find(
      (s: { channel: string; purpose: string }) =>
        s.channel === 'whatsapp' && s.purpose === 'marketing',
    );
    expect(wa).toMatchObject({ status: 'withdrawn', method: 'replied STOP' });
  });

  it('agents see only their own contacts and cannot erase', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const ownersContact = await http().post('/v1/contacts').set(o.h).send(contact()).expect(201);
    const mine = await http()
      .post('/v1/contacts')
      .set(agent.h)
      .send(contact({ fullName: 'Agent Lead', phone: '+971509998877', email: null }))
      .expect(201);
    const list = await http().get('/v1/contacts').set(agent.h).expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([mine.body.id]);
    await http().get(`/v1/contacts/${ownersContact.body.id}`).set(agent.h).expect(404);
    await http().delete(`/v1/contacts/${mine.body.id}`).set(agent.h).expect(403);
    // Duplicate check does not leak which contact holds the number.
    const dup = await http()
      .post('/v1/contacts')
      .set(agent.h)
      .send(contact({ fullName: 'Again' }))
      .expect(409);
    expect(dup.body.errors).toBeUndefined();
    // Owners see everything and can erase.
    const all = await http().get('/v1/contacts').set(o.h).expect(200);
    expect(all.body.total).toBe(2);
    await http().delete(`/v1/contacts/${mine.body.id}`).set(o.h).expect(204);
    await http().get(`/v1/contacts/${mine.body.id}`).set(o.h).expect(404);
  });

  it('another agency cannot see or touch the contact', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const c = await http().post('/v1/contacts').set(a.h).send(contact()).expect(201);
    await http().get(`/v1/contacts/${c.body.id}`).set(b.h).expect(404);
    await http().patch(`/v1/contacts/${c.body.id}`).set(b.h).send({ fullName: 'X' }).expect(404);
    await http().delete(`/v1/contacts/${c.body.id}`).set(b.h).expect(404);
    // The same number is fine in another agency.
    await http().post('/v1/contacts').set(b.h).send(contact()).expect(201);
  });
});

describe('leads', () => {
  it('runs a lead through the pipeline with a timeline and dashboard counts', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const c = await http().post('/v1/contacts').set(o.h).send(contact()).expect(201);
    const lead = await http()
      .post('/v1/leads')
      .set(o.h)
      .send({
        contactId: c.body.id,
        intent: 'buy',
        emirate: 'Dubai',
        communities: ['Dubai Marina'],
        propertyTypes: ['apartment'],
        bedroomsMin: 1,
        bedroomsMax: 2,
        budgetMin: 1_500_000,
        budgetMax: 2_500_000,
        nextFollowUpAt: new Date(Date.now() - 60_000).toISOString(),
        note: 'Wants sea view',
      })
      .expect(201);
    expect(lead.body).toMatchObject({ stage: 'new', assigned: { id: o.membershipId } });

    await http()
      .post(`/v1/leads/${lead.body.id}/stage`)
      .set(o.h)
      .send({ stage: 'qualified' })
      .expect(200);
    await http()
      .post(`/v1/leads/${lead.body.id}/stage`)
      .set(o.h)
      .send({ stage: 'lost' })
      .expect(400);
    await http()
      .post(`/v1/leads/${lead.body.id}/notes`)
      .set(o.h)
      .send({ body: 'Viewing Saturday' })
      .expect(201);

    const summary = await http().get('/v1/crm/summary').set(o.h).expect(200);
    expect(summary.body).toMatchObject({ open: 1, followUpsDue: 1, newThisWeek: 1, contacts: 1 });
    expect(summary.body.stages).toEqual({ qualified: 1 });

    const detail = await http().get(`/v1/leads/${lead.body.id}`).set(o.h).expect(200);
    expect(detail.body.activities.map((a: { type: string }) => a.type)).toEqual([
      'note',
      'stage_changed',
      'note',
      'created',
    ]);

    await http()
      .post(`/v1/leads/${lead.body.id}/stage`)
      .set(o.h)
      .send({ stage: 'lost', lostReason: 'Bought elsewhere' })
      .expect(200);
    const after = await http().get('/v1/crm/summary').set(o.h).expect(200);
    expect(after.body).toMatchObject({ open: 0, followUpsDue: 0 });
  });

  it('rejects inverted ranges', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const c = await http().post('/v1/contacts').set(o.h).send(contact()).expect(201);
    await http()
      .post('/v1/leads')
      .set(o.h)
      .send({ contactId: c.body.id, intent: 'rent', budgetMin: 200_000, budgetMax: 100_000 })
      .expect(400);
    const lead = await http()
      .post('/v1/leads')
      .set(o.h)
      .send({ contactId: c.body.id, intent: 'rent', budgetMax: 100_000 })
      .expect(201);
    await http()
      .patch(`/v1/leads/${lead.body.id}`)
      .set(o.h)
      .send({ budgetMin: 150_000 })
      .expect(400);
  });

  it('agents work only their own leads; managers assign them', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const other = await inviteNew(o, 'agent2@a.test', 'agent');
    const c = await http().post('/v1/contacts').set(o.h).send(contact()).expect(201);
    const lead = await http()
      .post('/v1/leads')
      .set(o.h)
      .send({ contactId: c.body.id, intent: 'buy' })
      .expect(201);

    // Not assigned yet: the agent sees neither the lead nor the contact.
    await http().get(`/v1/leads/${lead.body.id}`).set(agent.h).expect(404);
    await http().get(`/v1/contacts/${c.body.id}`).set(agent.h).expect(404);
    // Agents cannot assign.
    await http()
      .post(`/v1/leads/${lead.body.id}/assign`)
      .set(agent.h)
      .send({ membershipId: agent.membershipId })
      .expect(403);

    await http()
      .post(`/v1/leads/${lead.body.id}/assign`)
      .set(o.h)
      .send({ membershipId: agent.membershipId })
      .expect(200);
    await http().get(`/v1/leads/${lead.body.id}`).set(agent.h).expect(200);
    // Through the lead, the agent can now see the contact.
    await http().get(`/v1/contacts/${c.body.id}`).set(agent.h).expect(200);
    await http()
      .post(`/v1/leads/${lead.body.id}/stage`)
      .set(agent.h)
      .send({ stage: 'contacted' })
      .expect(200);
    await http().get(`/v1/leads/${lead.body.id}`).set(other.h).expect(404);
    await http().delete(`/v1/leads/${lead.body.id}`).set(agent.h).expect(403);

    const mineOnly = await http().get('/v1/leads').set(agent.h).expect(200);
    expect(mineOnly.body.total).toBe(1);
    const otherSees = await http().get('/v1/leads').set(other.h).expect(200);
    expect(otherSees.body.total).toBe(0);
  });

  it('cannot attach a lead to another agency’s contact or listing', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const bContact = await http().post('/v1/contacts').set(b.h).send(contact()).expect(201);
    await http()
      .post('/v1/leads')
      .set(a.h)
      .send({ contactId: bContact.body.id, intent: 'buy' })
      .expect(404);
    const aContact = await http().post('/v1/contacts').set(a.h).send(contact()).expect(201);
    const bListing = await http()
      .post('/v1/properties')
      .set(b.h)
      .send({ listingType: 'sale', propertyType: 'villa', emirate: 'Dubai' })
      .expect(201);
    await http()
      .post('/v1/leads')
      .set(a.h)
      .send({ contactId: aContact.body.id, intent: 'buy', propertyId: bListing.body.id })
      .expect(404);
  });
});

describe('mayContact (the check every outbound message must pass)', () => {
  it('fails closed: unknown, withdrawn or do-not-contact all mean no', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const c = await http()
      .post('/v1/contacts')
      .set(o.h)
      .send(contact({ consents: [{ channel: 'whatsapp', purpose: 'service', method: 'form' }] }))
      .expect(201);
    const check = (channel: 'whatsapp' | 'sms', purpose: 'service' | 'marketing') =>
      withTenant(t.app.get(PRISMA), { tenantId: o.tenantId }, (tx) =>
        mayContact(tx, c.body.id, channel, purpose),
      );
    expect(await check('whatsapp', 'service')).toBe(true);
    expect(await check('whatsapp', 'marketing')).toBe(false);
    expect(await check('sms', 'service')).toBe(false);
    await http()
      .patch(`/v1/contacts/${c.body.id}`)
      .set(o.h)
      .send({ doNotContact: true })
      .expect(200);
    expect(await check('whatsapp', 'service')).toBe(false);
  });
});
