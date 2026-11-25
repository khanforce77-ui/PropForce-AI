import { FakeWhatsAppClient } from '@propforce/whatsapp';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiDispatcher } from '../src/ai/ai-dispatcher';
import { WHATSAPP_CLIENT } from '../src/whatsapp/whatsapp.providers';
import { actors, type Headers, type Owner } from './actors';
import { createTestApp, resetDatabase, resetRateLimits, type TestApp } from './helpers';

const SECRET = 'campaign-test-app-secret';
let t: TestApp;
const { http, createOwner, inviteNew } = actors(() => t);
const wa = () => t.app.get<FakeWhatsAppClient>(WHATSAPP_CLIENT);

beforeAll(async () => {
  t = await createTestApp({
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
    META_APP_SECRET: SECRET,
    AI_PROVIDER: 'none',
  });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.app.get(AiDispatcher).idle();
  await resetDatabase(t.owner);
  resetRateLimits(t.app);
  t.emails.length = 0;
  wa().sent.length = 0;
});

async function connect(o: Owner, phoneNumberId = '111') {
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

let n = 0;
async function contact(h: Headers, over: Record<string, unknown> = {}, marketing = true) {
  n += 1;
  const res = await http()
    .post('/v1/contacts')
    .set(h)
    .send({
      fullName: `Mariam Client${n}`,
      phone: `+9715520000${String(n).padStart(2, '0')}`,
      tags: ['investor'],
      ...(marketing
        ? { consents: [{ channel: 'whatsapp', purpose: 'marketing', method: 'web form tick' }] }
        : {}),
      ...over,
    })
    .expect(201);
  return res.body as { id: string; phoneE164: string };
}

async function clientSays(text: string, from: string) {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '97141234567', phone_number_id: '111' },
              contacts: [{ wa_id: from, profile: { name: 'Client' } }],
              messages: [
                {
                  from,
                  id: `wamid.in.${Date.now()}.${Math.random()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
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
  const sig = `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  await http()
    .post('/v1/webhooks/whatsapp')
    .set('content-type', 'application/json')
    .set('x-hub-signature-256', sig)
    .send(raw)
    .expect(200);
  await t.app.get(AiDispatcher).idle();
}

describe('lead booster campaigns', () => {
  it('sends only to consented contacts, only after approval, and tracks replies', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const manager = await inviteNew(o, 'manager@a.test', 'manager');
    const accountId = await connect(o);
    const yes1 = await contact(o.h);
    const yes2 = await contact(o.h, { fullName: 'Omar Al Farsi' });
    await contact(o.h, {}, false); // no marketing consent
    await contact(o.h, { doNotContact: true });
    await contact(o.h, { tags: ['tenant'] }); // outside the segment

    const senders = await http().get('/v1/campaigns/senders').set(manager.h).expect(200);
    expect(senders.body.data).toEqual([{ id: accountId, displayPhoneNumber: '+971 4 123 4567' }]);
    const created = await http()
      .post('/v1/campaigns')
      .set(manager.h)
      .send({
        name: 'Marina launch',
        whatsappAccountId: accountId,
        templateName: 'new_listing_alert',
        bodyParams: ['{first_name}', '{agency_name}'],
        audience: { tags: ['investor'] },
      })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body.status).toBe('draft');

    const preview = await http().get(`/v1/campaigns/${id}/preview`).set(manager.h).expect(200);
    expect(preview.body).toMatchObject({
      matched: 4,
      eligible: 2,
      skipped: { no_phone: 0, do_not_contact: 1, no_marketing_consent: 1 },
    });
    expect(preview.body.sample[1].params).toEqual(['Omar', 'Alpha Realty']);

    // Not approved: cannot send. Managers cannot approve or send.
    await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(422);
    const submitted = await http().post(`/v1/campaigns/${id}/submit`).set(manager.h).expect(200);
    expect(submitted.body).toMatchObject({
      status: 'pending_approval',
      counts: { queued: 2, skipped: 2 },
    });
    await http().post(`/v1/campaigns/${id}/approve`).set(manager.h).expect(403);
    await http().post(`/v1/campaigns/${id}/send`).set(manager.h).expect(403);
    await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(422);
    await http().post(`/v1/campaigns/${id}/approve`).set(o.h).expect(200);

    // Consent withdrawn after approval: re-checked at send time.
    await http()
      .post(`/v1/contacts/${yes2.id}/consents`)
      .set(o.h)
      .send({
        channel: 'whatsapp',
        purpose: 'marketing',
        status: 'withdrawn',
        method: 'asked by phone',
      })
      .expect(201);

    const sent = await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(200);
    expect(sent.body).toMatchObject({ status: 'completed', sentNow: 1 });
    expect(wa().sent).toHaveLength(1);
    expect(wa().sent[0]!.msg).toEqual({
      type: 'template',
      to: yes1.phoneE164.slice(1),
      templateName: 'new_listing_alert',
      languageCode: 'en',
      bodyParams: [`Mariam`, 'Alpha Realty'],
    });

    // The message shows in the inbox, and the client's answer counts as a reply.
    const convs = await http().get('/v1/conversations').set(o.h).expect(200);
    expect(convs.body.data).toHaveLength(1);
    await clientSays('Interested, send details', yes1.phoneE164.slice(1));
    const recips = await http().get(`/v1/campaigns/${id}/recipients`).set(o.h).expect(200);
    const statuses = recips.body.data.map((r: { status: string }) => r.status).sort();
    expect(statuses).toEqual(['replied', 'skipped', 'skipped', 'skipped']);

    await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(422);
    const logs = await http().get('/v1/audit-logs?entityType=campaign').set(o.h).expect(200);
    expect(logs.body.data.map((l: { action: string }) => l.action)).toEqual(
      expect.arrayContaining([
        'campaign.created',
        'campaign.submitted',
        'campaign.approved',
        'campaign.completed',
      ]),
    );
  });

  it('respects the daily limit, refuses empty audiences and keeps agencies apart', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const accountId = await connect(o);
    for (let i = 0; i < 3; i += 1) await contact(o.h);
    const make = async (body: Record<string, unknown>) =>
      (
        await http()
          .post('/v1/campaigns')
          .set(o.h)
          .send({ name: 'C', whatsappAccountId: accountId, templateName: 'promo', ...body })
          .expect(201)
      ).body.id as string;

    const id = await make({ dailyLimit: 2 });
    await http().post(`/v1/campaigns/${id}/submit`).set(o.h).expect(200);
    await http().post(`/v1/campaigns/${id}/approve`).set(o.h).expect(200);
    const first = await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(200);
    expect(first.body).toMatchObject({ status: 'sending', sentNow: 2, counts: { queued: 1 } });
    const limited = await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(429);
    expect(limited.body.code).toBe('DAILY_LIMIT_REACHED');

    const empty = await make({ audience: { tags: ['nobody'] } });
    const res = await http().post(`/v1/campaigns/${empty}/submit`).set(o.h).expect(422);
    expect(res.body.code).toBe('NO_ELIGIBLE_RECIPIENTS');

    const other = await createOwner('owner@b.test', 'Beta Homes');
    await http().get(`/v1/campaigns/${id}`).set(other.h).expect(404);
    await http().post(`/v1/campaigns/${id}/send`).set(other.h).expect(404);
    await http()
      .post('/v1/campaigns')
      .set(other.h)
      .send({ name: 'X', whatsappAccountId: accountId, templateName: 'promo' })
      .expect(422);
    // Agents have no access to campaigns.
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    await http().get('/v1/campaigns').set(agent.h).expect(403);
  });

  it('stops when Meta rejects the template', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const accountId = await connect(o);
    for (let i = 0; i < 3; i += 1) await contact(o.h);
    const id = (
      await http()
        .post('/v1/campaigns')
        .set(o.h)
        .send({ name: 'Bad', whatsappAccountId: accountId, templateName: 'missing_template' })
        .expect(201)
    ).body.id;
    await http().post(`/v1/campaigns/${id}/submit`).set(o.h).expect(200);
    await http().post(`/v1/campaigns/${id}/approve`).set(o.h).expect(200);
    const client = wa();
    const original = client.send.bind(client);
    client.send = async () => ({
      ok: false,
      retryable: false,
      code: 'TEMPLATE_ERROR',
      providerCode: 132001,
    });
    try {
      const res = await http().post(`/v1/campaigns/${id}/send`).set(o.h).expect(200);
      expect(res.body.stopped).toMatch(/rejected the template/);
      expect(res.body.counts).toMatchObject({ failed: 1, queued: 2 });
    } finally {
      client.send = original;
    }
  });
});
