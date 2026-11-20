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
import { withTenant, type PrismaClient } from '@propforce/db';
import { FakeWhatsAppClient } from '@propforce/whatsapp';
import { createHmac } from 'node:crypto';
import { mayContact } from '../src/crm/consent';
import { PRISMA } from '../src/database/database.module';
import { WHATSAPP_CLIENT } from '../src/whatsapp/whatsapp.providers';

const SECRET = 'test-meta-app-secret';

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  t = await createTestApp({
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    META_APP_SECRET: SECRET,
    META_WEBHOOK_VERIFY_TOKEN: 'verify-me',
  });
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

const PHONE_ID = '106540352242922';

async function connect(o: Owner, phoneNumberId = PHONE_ID) {
  const res = await http()
    .post('/v1/whatsapp/accounts')
    .set(o.h)
    .send({
      code: 'AQD-signup-code-1234',
      wabaId: '102290129340398',
      phoneNumberId,
      displayPhoneNumber: '+971 4 123 4567',
    })
    .expect(201);
  return res.body.id as string;
}

let seq = 0;
const inboundPayload = (
  text: string,
  opts: { from?: string; wamid?: string; phoneNumberId?: string; ts?: number } = {},
) => ({
  object: 'whatsapp_business_account',
  entry: [
    {
      id: '102290129340398',
      changes: [
        {
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: {
              display_phone_number: '97141234567',
              phone_number_id: opts.phoneNumberId ?? PHONE_ID,
            },
            contacts: [{ wa_id: opts.from ?? '971501234567', profile: { name: 'Sara Client' } }],
            messages: [
              {
                from: opts.from ?? '971501234567',
                id: opts.wamid ?? `wamid.test.${++seq}`,
                timestamp: String(opts.ts ?? Math.floor(Date.now() / 1000)),
                type: 'text',
                text: { body: text },
              },
            ],
          },
        },
      ],
    },
  ],
});

async function deliver(payload: unknown, secret = SECRET, expectStatus = 200) {
  const raw = JSON.stringify(payload);
  const sig = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return http()
    .post('/v1/webhooks/whatsapp')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(raw)
    .expect(expectStatus);
}

const fake = () => app.get<FakeWhatsAppClient>(WHATSAPP_CLIENT);
const prisma = () => app.get<PrismaClient>(PRISMA);

describe('WhatsApp webhook', () => {
  it('answers the Meta verification handshake only with the right token', async () => {
    const ok = await http()
      .get('/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' })
      .expect(200);
    expect(ok.text).toBe('12345');
    await http()
      .get('/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '12345' })
      .expect(403);
  });

  it('rejects unsigned or wrongly signed deliveries without storing anything', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await connect(o);
    await deliver(inboundPayload('hi'), 'not-the-secret', 401);
    await http().post('/v1/webhooks/whatsapp').send(inboundPayload('hi')).expect(401);
    expect(await t.owner.message.count()).toBe(0);
  });

  it('stores an inbound message once, creating contact, conversation and service consent', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await connect(o);
    const p = inboundPayload('Hi, any 2 bed in Marina?', { wamid: 'wamid.same' });
    await deliver(p);
    await deliver(p); // Meta retry
    expect(await t.owner.message.count()).toBe(1);
    const contacts = await t.owner.contact.findMany();
    expect(contacts).toEqual([
      expect.objectContaining({
        phoneE164: '+971501234567',
        fullName: 'Sara Client',
        source: 'whatsapp',
      }),
    ]);
    const list = await http().get('/v1/conversations').set(o.h).expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        mode: 'ai',
        unreadCount: 1,
        lastMessage: expect.objectContaining({ body: 'Hi, any 2 bed in Marina?' }),
      }),
    ]);
    const ok = await withTenant(prisma(), { tenantId: o.tenantId }, (tx) =>
      mayContact(tx, contacts[0]!.id, 'whatsapp', 'service'),
    );
    expect(ok).toBe(true);
    // Reading the thread clears the unread count.
    const msgs = await http()
      .get(`/v1/conversations/${list.body.data[0].id}/messages`)
      .set(o.h)
      .expect(200);
    expect(msgs.body.data).toHaveLength(1);
    const again = await http().get('/v1/conversations').set(o.h).expect(200);
    expect(again.body.data[0].unreadCount).toBe(0);
  });

  it('ignores messages for numbers no agency has connected', async () => {
    await deliver(inboundPayload('hi', { phoneNumberId: '999' }));
    expect(await t.owner.message.count()).toBe(0);
  });

  it('routes each number to its own agency only', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    await connect(a, '111');
    await connect(b, '222');
    await deliver(inboundPayload('for alpha', { phoneNumberId: '111' }));
    await deliver(inboundPayload('for bravo', { phoneNumberId: '222' }));
    const la = await http().get('/v1/conversations').set(a.h).expect(200);
    const lb = await http().get('/v1/conversations').set(b.h).expect(200);
    expect(la.body.data.map((c: { lastMessage: { body: string } }) => c.lastMessage.body)).toEqual([
      'for alpha',
    ]);
    expect(lb.body.data.map((c: { lastMessage: { body: string } }) => c.lastMessage.body)).toEqual([
      'for bravo',
    ]);
    // Bravo cannot open Alpha's conversation.
    await http().get(`/v1/conversations/${la.body.data[0].id}/messages`).set(b.h).expect(404);
  });

  it('STOP withdraws consent immediately, stops the AI and blocks replies', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await connect(o);
    await deliver(inboundPayload('hello'));
    await deliver(inboundPayload('STOP'));
    const list = await http().get('/v1/conversations').set(o.h).expect(200);
    const conv = list.body.data[0];
    expect(conv.mode).toBe('human');
    const res = await http()
      .post(`/v1/conversations/${conv.id}/messages`)
      .set(o.h)
      .send({ body: 'Are you sure?' })
      .expect(422);
    expect(res.body.code).toBe('CONSENT_MISSING');
    await http().post(`/v1/conversations/${conv.id}/release-to-ai`).set(o.h).expect(422);
    expect(fake().sent).toHaveLength(0);
    // A later normal message does not silently restore consent; START does.
    await deliver(inboundPayload('hi again'));
    await http()
      .post(`/v1/conversations/${conv.id}/messages`)
      .set(o.h)
      .send({ body: 'x' })
      .expect(422);
    await deliver(inboundPayload('START'));
    await http()
      .post(`/v1/conversations/${conv.id}/messages`)
      .set(o.h)
      .send({ body: 'Welcome back' })
      .expect(201);
    const logs = await http().get('/v1/audit-logs?entityType=contact').set(o.h).expect(200);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining(['consent.withdrawn', 'consent.granted']),
    );
  });
});

describe('agent replies', () => {
  it('sends with the agency token, takes over from the AI and tracks delivery status', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await connect(o);
    await deliver(inboundPayload('hello'));
    const conv = (await http().get('/v1/conversations').set(o.h).expect(200)).body.data[0];
    const sent = await http()
      .post(`/v1/conversations/${conv.id}/messages`)
      .set(o.h)
      .send({ body: 'Hi Sara!' })
      .expect(201);
    expect(sent.body.status).toBe('sent');
    const out = fake().sent.at(-1)!;
    expect(out.msg).toEqual({ type: 'text', to: '971501234567', body: 'Hi Sara!' });
    expect(out.creds).toEqual({ phoneNumberId: PHONE_ID, accessToken: 'fake-token-for-AQD-sign' });
    const after = (await http().get('/v1/conversations').set(o.h).expect(200)).body.data[0];
    expect(after.mode).toBe('human');
    // Token is stored encrypted, never in clear.
    const acc = await t.owner.whatsAppAccount.findFirstOrThrow();
    expect(Buffer.from(acc.accessTokenEnc).toString('utf8')).not.toContain('fake-token');
    // Status webhooks move forward only.
    const status = (s: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: '1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '1', phone_number_id: PHONE_ID },
                statuses: [
                  {
                    id: out.wamid,
                    status: s,
                    timestamp: '1763668800',
                    recipient_id: '971501234567',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await deliver(status('read'));
    await deliver(status('delivered')); // late, ignored
    const msg = await t.owner.message.findFirstOrThrow({ where: { wamid: out.wamid } });
    expect(msg.status).toBe('read');
  });

  it('refuses free text after the 24-hour window', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await connect(o);
    await deliver(inboundPayload('hello', { ts: Math.floor(Date.now() / 1000) - 25 * 3600 }));
    const conv = (await http().get('/v1/conversations').set(o.h).expect(200)).body.data[0];
    const res = await http()
      .post(`/v1/conversations/${conv.id}/messages`)
      .set(o.h)
      .send({ body: 'late' })
      .expect(422);
    expect(res.body.code).toBe('WA_WINDOW_CLOSED');
  });

  it('agents see only conversations assigned to them; only admins manage numbers', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await connect(o);
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    await deliver(inboundPayload('unassigned client'));
    expect((await http().get('/v1/conversations').set(agent.h).expect(200)).body.data).toHaveLength(
      0,
    );
    await t.owner.conversation.updateMany({ data: { assignedMembershipId: agent.membershipId } });
    expect((await http().get('/v1/conversations').set(agent.h).expect(200)).body.data).toHaveLength(
      1,
    );
    await http().get('/v1/whatsapp/accounts').set(agent.h).expect(403);
    await http()
      .post('/v1/whatsapp/accounts')
      .set(agent.h)
      .send({
        code: 'AQD-signup-code-1234',
        wabaId: '1',
        phoneNumberId: '2',
        displayPhoneNumber: '+971 4 000 0000',
      })
      .expect(403);
  });

  it('a number can be connected by only one agency, and disconnecting stops routing', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const id = await connect(a);
    const dup = await http()
      .post('/v1/whatsapp/accounts')
      .set(b.h)
      .send({
        code: 'AQD-signup-code-1234',
        wabaId: '1',
        phoneNumberId: PHONE_ID,
        displayPhoneNumber: '+971 4 000 0000',
      })
      .expect(409);
    expect(dup.body.code).toBe('CONFLICT_DUPLICATE');
    const list = await http().get('/v1/whatsapp/accounts').set(a.h).expect(200);
    expect(list.body[0]).not.toHaveProperty('accessTokenEnc');
    await http().post(`/v1/whatsapp/accounts/${id}/disconnect`).set(a.h).expect(204);
    await deliver(inboundPayload('after disconnect'));
    expect(await t.owner.message.count()).toBe(0);
  });
});
