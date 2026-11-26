import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actors } from './actors';
import { createTestApp, resetDatabase, resetRateLimits, type TestApp } from './helpers';

// Random per run: a fixture, not a credential.
const SECRET = randomBytes(16).toString('hex');
let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const { createOwner, inviteNew } = actors(() => t);

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', VAPI_WEBHOOK_SECRET: SECRET });
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

const report = (callId: string, phoneNumberId: string, from = '+971501112233') => ({
  message: {
    type: 'end-of-call-report',
    endedReason: 'customer-ended-call',
    startedAt: '2026-11-26T10:00:00.000Z',
    endedAt: '2026-11-26T10:01:30.000Z',
    cost: 0.08,
    artifact: { transcript: 'AI: Hello, this is an AI assistant.\nUser: Any 2 beds?' },
    analysis: { summary: 'Looking for a 2 bed.' },
    call: { id: callId, type: 'inboundPhoneCall', phoneNumberId },
    customer: { number: from },
  },
});
const hook = (body: unknown, auth = `Bearer ${SECRET}`) =>
  http()
    .post('/v1/webhooks/voice/vapi')
    .set('Authorization', auth)
    .send(body as object);

describe('voice calls', () => {
  it('stores Vapi end-of-call reports for the agency that owns the line', async () => {
    const a = await createOwner('owner@a.test', 'Alpha Realty');
    const b = await createOwner('owner@b.test', 'Bravo Homes');
    const agent = await inviteNew(a, 'agent@a.test', 'agent');

    // Only owners/admins manage lines.
    await http()
      .post('/v1/voice/lines')
      .set(agent.h)
      .send({ providerPhoneNumberId: 'pn_a' })
      .expect(403);
    const line = await http()
      .post('/v1/voice/lines')
      .set(a.h)
      .send({ providerPhoneNumberId: 'pn_a', phoneE164: '+97142000000', label: 'Main' })
      .expect(201);
    expect(line.body.transcriptPolicy).toBe('summary_only');
    // A number belongs to one agency.
    await http()
      .post('/v1/voice/lines')
      .set(b.h)
      .send({ providerPhoneNumberId: 'pn_a' })
      .expect(409);

    // Bad or missing credentials.
    await hook(report('c1', 'pn_a'), 'Bearer wrong').expect(401);
    await http().post('/v1/webhooks/voice/vapi').send(report('c1', 'pn_a')).expect(401);

    const res = await hook(report('c1', 'pn_a')).expect(200);
    expect(res.body.outcome).toBe('stored');
    expect((await hook(report('c1', 'pn_a')).expect(200)).body.outcome).toBe('duplicate');
    expect((await hook(report('c9', 'pn_unknown')).expect(200)).body.outcome).toBe('unknown_line');
    // Other server messages are acknowledged and ignored; the legacy header also works.
    await http()
      .post('/v1/webhooks/voice/vapi')
      .set('X-Vapi-Secret', SECRET)
      .send({ message: { type: 'status-update', status: 'ringing' } })
      .expect(200);

    const calls = await http().get('/v1/calls').set(a.h).expect(200);
    expect(calls.body.data).toHaveLength(1);
    expect(calls.body.data[0]).toMatchObject({
      callerE164: '+971501112233',
      durationSec: 90,
      summary: 'Looking for a 2 bed.',
      costUsd: 0.08,
      contact: { fullName: '+971501112233' },
    });
    const detail = await http().get(`/v1/calls/${calls.body.data[0].id}`).set(a.h).expect(200);
    // Summary-only policy: no transcript kept.
    expect(detail.body.transcript).toBeNull();

    // New caller became a contact with no consent recorded.
    const contact = await t.owner.contact.findFirstOrThrow({ where: { tenantId: a.tenantId } });
    expect(contact.source).toBe('phone');
    expect(await t.owner.consentRecord.count({ where: { contactId: contact.id } })).toBe(0);

    // Agents only see calls from their own contacts; other agencies see nothing.
    expect((await http().get('/v1/calls').set(agent.h).expect(200)).body.data).toHaveLength(0);
    expect((await http().get('/v1/calls').set(b.h).expect(200)).body.data).toHaveLength(0);
    await http().get(`/v1/calls/${calls.body.data[0].id}`).set(b.h).expect(404);

    // Full-transcript policy keeps the transcript; a switched-off line stops storing calls.
    await http()
      .patch(`/v1/voice/lines/${line.body.id}`)
      .set(a.h)
      .send({ transcriptPolicy: 'full_transcript' })
      .expect(200);
    await hook(report('c2', 'pn_a', '+971501112233')).expect(200);
    const c2 = await t.owner.voiceCall.findFirstOrThrow({ where: { providerCallId: 'c2' } });
    expect(c2.transcript).toContain('AI assistant');
    expect(c2.contactId).toBe(contact.id);
    await http()
      .patch(`/v1/voice/lines/${line.body.id}`)
      .set(a.h)
      .send({ active: false })
      .expect(200);
    expect((await hook(report('c3', 'pn_a')).expect(200)).body.outcome).toBe('unknown_line');

    // Erasing the contact removes its calls.
    await http().delete(`/v1/contacts/${contact.id}`).set(a.h).expect(204);
    expect(await t.owner.voiceCall.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  it('refuses webhooks when no secret is configured', async () => {
    const t2 = await createTestApp({});
    try {
      await request(t2.app.getHttpServer())
        .post('/v1/webhooks/voice/vapi')
        .set('Authorization', `Bearer ${SECRET}`)
        .send(report('c1', 'pn_a'))
        .expect(503);
    } finally {
      await t2.close();
    }
  });
});
