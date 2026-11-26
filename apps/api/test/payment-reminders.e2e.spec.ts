import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentRemindersService } from '../src/payment-reminders/payment-reminders.service';
import {
  REMINDER_CALLER,
  SMS_SENDER,
  type ReminderCaller,
  type SmsSender,
} from '../src/payment-reminders/reminder-channels';
import { actors, type Headers, type Owner } from './actors';
import {
  createTestApp,
  registration,
  resetDatabase,
  resetRateLimits,
  tokenFrom,
  type TestApp,
} from './helpers';

// A fixture, not a credential.
const CRON = 'cron-secret-for-tests-only-0123';
let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const { createOwner, inviteNew, loginAs, enableMfa } = actors(() => t);

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000', CRON_SECRET: CRON });
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

/** Registers a developer owner (MFA on, onboarding complete so the account is active). */
async function createDeveloper(email: string, name: string): Promise<Owner> {
  const body = registration({ email, agency: { name, emirate: 'Dubai' }, accountType: 'developer' });
  await http().post('/v1/auth/register').send(body).expect(202);
  await http()
    .post('/v1/auth/verify-email')
    .send({ token: tokenFrom(t.emails.at(-1)) })
    .expect(204);
  const auth = await loginAs(email, body.password);
  await enableMfa(auth);
  const me = await http().get('/v1/me').set(auth).expect(200);
  const m = me.body.memberships[0];
  expect(m.agency.kind).toBe('developer');
  const h: Headers = { ...auth, 'X-Tenant-Id': m.agency.id };
  await http().post('/v1/agency/onboarding/complete').set(h).expect(200);
  t.emails.length = 0;
  return { userId: me.body.user.id, tenantId: m.agency.id, membershipId: m.id, auth, h };
}

// 10:00 in Dubai on 1 Dec 2026 (inside AI calling hours).
const NOW = new Date('2026-12-01T06:00:00.000Z');

const plan = (overrides: Record<string, unknown> = {}) => ({
  buyer: { fullName: 'Sara <b>Ali</b>', phone: '050 111 2233', email: 'sara@buyer.test' },
  projectName: 'Marina Heights',
  unitRef: '1204',
  totalPrice: 1_000_000,
  installments: [
    { label: 'Installment 1', dueDate: '2026-11-28', amount: 100_000 }, // 3 days overdue
    { label: 'Installment 2', dueDate: '2026-12-01', amount: 100_000 }, // due today
    { label: 'Installment 3', dueDate: '2026-12-08', amount: 100_000 }, // in 7 days
    { label: 'Handover', dueDate: '2027-06-30', amount: 700_000 }, // later
  ],
  reminderConsent: ['email'],
  ...overrides,
});

describe('developer accounts', () => {
  it('registers developers in Dubai only and keeps payment features to developers', async () => {
    await http()
      .post('/v1/auth/register')
      .send(
        registration({
          email: 'dev@ad.test',
          agency: { name: 'AD Dev', emirate: 'Abu Dhabi' },
          accountType: 'developer',
        }),
      )
      .expect(400);

    const agency = await createOwner('owner@agency.test', 'Alpha Realty');
    const me = await http().get('/v1/me').set(agency.auth).expect(200);
    expect(me.body.memberships[0].agency.kind).toBe('agency');
    const res = await http().get('/v1/payment-plans').set(agency.h).expect(403);
    expect(res.body.code).toBe('DEVELOPER_ONLY');
    await http().get('/v1/payment-reminders/config').set(agency.h).expect(403);
  });
});

describe('payment plans', () => {
  it('creates a plan with a new buyer, records consent and tracks payments', async () => {
    const dev = await createDeveloper('owner@dev.test', 'Skyline Developments');
    const created = await http().post('/v1/payment-plans').set(dev.h).send(plan()).expect(201);
    expect(created.body.installments).toHaveLength(4);
    expect(created.body.installments.map((i: { seq: number }) => i.seq)).toEqual([1, 2, 3, 4]);
    expect(created.body.contact.reminderConsent).toEqual({
      email: 'granted',
      sms: 'unknown',
      ai_call: 'unknown',
    });
    expect(created.body.contact.phoneE164).toBe('+971501112233');

    // The same phone cannot create a second buyer.
    const clash = await http().post('/v1/payment-plans').set(dev.h).send(plan()).expect(409);
    expect(clash.body.code).toBe('CONTACT_PHONE_EXISTS');
    // An existing buyer can get another plan.
    await http()
      .post('/v1/payment-plans')
      .set(dev.h)
      .send({ ...plan(), buyer: undefined, contactId: created.body.contact.id, unitRef: '1205' })
      .expect(201);

    const list = await http().get('/v1/payment-plans').set(dev.h).expect(200);
    expect(list.body.data).toHaveLength(2);

    // Mark every installment paid: the plan completes.
    let p = created.body;
    for (const i of p.installments) {
      p = (
        await http()
          .patch(`/v1/payment-plans/${p.id}/installments/${i.id}`)
          .set(dev.h)
          .send({ status: 'paid', paidNote: 'Bank transfer' })
          .expect(200)
      ).body;
    }
    expect(p.status).toBe('completed');
    expect(p.outstanding).toBe(0);
    expect(p.paidTotal).toBe(1_000_000);

    // Another developer cannot see it.
    const other = await createDeveloper('owner@other.test', 'Other Dev');
    await http().get(`/v1/payment-plans/${p.id}`).set(other.h).expect(404);

    // Roles: agents have no access; managers can add plans but not change reminder settings.
    const agent = await inviteNew(dev, 'agent@dev.test', 'agent');
    await http().get('/v1/payment-plans').set(agent.h).expect(403);
    const manager = await inviteNew(dev, 'manager@dev.test', 'manager');
    await http().get('/v1/payment-plans').set(manager.h).expect(200);
    await http().put('/v1/payment-reminders/config').set(manager.h).send({}).expect(403);
  });
});

describe('payment reminders', () => {
  it('sends each due reminder once, only with consent, and logs pending channels', async () => {
    const dev = await createDeveloper('owner@dev.test', 'Skyline Developments');
    const cfg = await http().get('/v1/payment-reminders/config').set(dev.h).expect(200);
    expect(cfg.body.rules.map((r: { offsetDays: number }) => r.offsetDays)).toEqual([-7, 0, 3]);
    expect(cfg.body.channels.email.ready).toBe(true);
    expect(cfg.body.channels.sms.ready).toBe(false);
    expect(cfg.body.channels.ai_call.ready).toBe(false);

    await http()
      .put('/v1/payment-reminders/config')
      .set(dev.h)
      .send({ contactPhone: '+97140000000', replyToEmail: 'accounts@skyline.test' })
      .expect(200);
    const created = await http().post('/v1/payment-plans').set(dev.h).send(plan()).expect(201);

    const service = app.get(PaymentRemindersService);
    const first = await service.runTenant(dev.tenantId, NOW);
    // 3 rules hit 3 installments: email x3 sent; sms x3 + ai_call x1 have no consent.
    expect(first).toMatchObject({ sent: 3, skippedNoConsent: 4, providerPending: 0, failed: 0 });
    expect(t.emails.map((e) => e.to)).toEqual(Array(3).fill('sara@buyer.test'));
    const subjects = t.emails.map((e) => e.subject).sort();
    expect(subjects).toEqual([
      'Overdue payment: Installment 1 for Marina Heights',
      'Payment reminder: Installment 3 due on 8 Dec 2026 – Marina Heights',
      'Your payment for Marina Heights is due today',
    ]);
    const overdue = t.emails.find((e) => e.subject.startsWith('Overdue'))!;
    expect(overdue.replyTo).toBe('accounts@skyline.test');
    expect(overdue.html).toContain('Sara &lt;b&gt;Ali&lt;/b&gt;');
    expect(overdue.html).toContain('AED 100,000');
    expect(overdue.text).toContain('3 days overdue');

    // A second run sends nothing new.
    t.emails.length = 0;
    const again = await service.runTenant(dev.tenantId, NOW);
    expect(again.considered).toBe(0);
    expect(t.emails).toHaveLength(0);

    const log = await http().get(`/v1/payment-reminders/log?planId=${created.body.id}`).set(dev.h).expect(200);
    expect(log.body.data).toHaveLength(7);

    // Buyer 2 agreed to SMS and calls. SMS provider connected; calls not switched on.
    const sms = app.get<SmsSender>(SMS_SENDER);
    Object.defineProperty(sms, 'configured', { value: true, configurable: true });
    const smsSend = vi.spyOn(sms, 'send').mockResolvedValue({ messageId: 'sms-1' });
    const caller = app.get<ReminderCaller>(REMINDER_CALLER);
    Object.defineProperty(caller, 'configured', { value: true, configurable: true });
    const call = vi.spyOn(caller, 'placeCall').mockResolvedValue({ providerCallId: 'call-1' });
    try {
      await http()
        .post('/v1/payment-plans')
        .set(dev.h)
        .send(
          plan({
            buyer: { fullName: 'Omar', phone: '050 999 8877' },
            reminderConsent: ['sms', 'ai_call', 'email'],
            installments: [{ label: 'Installment 1', dueDate: '2026-11-28', amount: 50_000 }],
          }),
        )
        .expect(201);
      const s2 = await service.runTenant(dev.tenantId, NOW);
      // Overdue rule: email has no address, SMS sent, call waits for the platform switch.
      expect(s2).toMatchObject({ sent: 1, skippedNoAddress: 1, providerPending: 1 });
      expect(smsSend).toHaveBeenCalledTimes(1);
      expect(smsSend.mock.calls[0]![0].text).toContain('Dear Omar');
      expect(smsSend.mock.calls[0]![0].toE164).toBe('+971509998877');
      expect(call).not.toHaveBeenCalled();

      // With outbound calls switched on, a third buyer's overdue call is placed in calling hours.
      await t.owner.featureFlag.update({ where: { key: 'voice.outbound_calls' }, data: { enabled: true } });
      await http()
        .post('/v1/payment-plans')
        .set(dev.h)
        .send(
          plan({
            buyer: { fullName: 'Lina', phone: '050 444 5566' },
            reminderConsent: ['ai_call'],
            installments: [{ label: 'Installment 1', dueDate: '2026-11-28', amount: 75_000 }],
          }),
        )
        .expect(201);
      // At 9 PM Dubai the call waits.
      const night = await service.runTenant(dev.tenantId, new Date('2026-12-01T17:00:00.000Z'));
      expect(night.deferredCalls).toBe(1);
      expect(call).not.toHaveBeenCalled();
      const s3 = await service.runTenant(dev.tenantId, NOW);
      expect(s3.sent).toBe(1);
      expect(call).toHaveBeenCalledTimes(1);
      const input = call.mock.calls[0]![0];
      expect(input.firstMessage).toContain('AI assistant');
      expect(input.instructions).toContain('AED 75,000');
      expect(input.metadata.source).toBe('payment_reminder');
    } finally {
      smsSend.mockRestore();
      call.mockRestore();
      Object.defineProperty(sms, 'configured', { value: false, configurable: true });
      Object.defineProperty(caller, 'configured', { value: false, configurable: true });
    }
  });

  it('skips paid installments, paused plans and do-not-contact buyers', async () => {
    const dev = await createDeveloper('owner@dev.test', 'Skyline Developments');
    const a = await http().post('/v1/payment-plans').set(dev.h).send(plan()).expect(201);
    for (const i of a.body.installments.slice(0, 3)) {
      await http()
        .patch(`/v1/payment-plans/${a.body.id}/installments/${i.id}`)
        .set(dev.h)
        .send({ status: 'paid' })
        .expect(200);
    }
    const b = await http()
      .post('/v1/payment-plans')
      .set(dev.h)
      .send(plan({ buyer: { fullName: 'Buyer B', email: 'b@buyer.test' } }))
      .expect(201);
    await http().patch(`/v1/payment-plans/${b.body.id}`).set(dev.h).send({ remindersPaused: true }).expect(200);
    const c = await http()
      .post('/v1/payment-plans')
      .set(dev.h)
      .send(plan({ buyer: { fullName: 'Buyer C', email: 'c@buyer.test' } }))
      .expect(201);
    await http().patch(`/v1/contacts/${c.body.contact.id}`).set(dev.h).send({ doNotContact: true }).expect(200);

    const s = await app.get(PaymentRemindersService).runTenant(dev.tenantId, NOW);
    expect(s.sent).toBe(0);
    expect(t.emails).toHaveLength(0);
    // Withdrawn consent also stops reminders.
    const d = await http()
      .post('/v1/payment-plans')
      .set(dev.h)
      .send(plan({ buyer: { fullName: 'Buyer D', email: 'd@buyer.test' } }))
      .expect(201);
    await http()
      .post(`/v1/payment-plans/${d.body.id}/consent`)
      .set(dev.h)
      .send({ channel: 'email', status: 'withdrawn' })
      .expect(201);
    const s2 = await app.get(PaymentRemindersService).runTenant(dev.tenantId, NOW);
    expect(s2.sent).toBe(0);
  });

  it('lets developers edit, preview, test and reset templates', async () => {
    const dev = await createDeveloper('owner@dev.test', 'Skyline Developments');
    const list = await http().get('/v1/payment-reminders/templates').set(dev.h).expect(200);
    expect(list.body.data).toHaveLength(9);
    expect(list.body.placeholders).toHaveProperty('buyer_name');

    await http()
      .put('/v1/payment-reminders/templates/email/before')
      .set(dev.h)
      .send({ subject: 'Hi {{buyer_nam}}', body: '<p>x</p>' })
      .expect(400);
    await http()
      .put('/v1/payment-reminders/templates/ai_call/due')
      .set(dev.h)
      .send({ subject: 'Hello, this is Skyline calling', body: 'Remind them.' })
      .expect(400);
    await http()
      .put('/v1/payment-reminders/templates/sms/due')
      .set(dev.h)
      .send({ body: 'x'.repeat(481) })
      .expect(400);

    const saved = await http()
      .put('/v1/payment-reminders/templates/email/before')
      .set(dev.h)
      .send({
        subject: '{{developer_name}}: {{amount}} due {{due_date}}',
        body: '<p onclick="steal()">Hello {{buyer_name}}</p><script>alert(1)</script><a href="javascript:alert(1)">pay</a>',
      })
      .expect(200);
    expect(saved.body.edited).toBe(true);
    const preview = await http()
      .post('/v1/payment-reminders/preview')
      .set(dev.h)
      .send({ channel: 'email', stage: 'before' })
      .expect(200);
    expect(preview.body.subject).toBe('Skyline Developments: AED 125,000 due 10 Dec 2026');
    expect(preview.body.html).toContain('Hello Ahmed Khan');
    expect(preview.body.html).not.toMatch(/script|onclick|javascript:/);

    const sms = await http()
      .post('/v1/payment-reminders/preview')
      .set(dev.h)
      .send({ channel: 'sms', stage: 'due' })
      .expect(200);
    expect(sms.body.text).toContain('due today');

    const test = await http()
      .post('/v1/payment-reminders/test-email')
      .set(dev.h)
      .send({ stage: 'before' })
      .expect(200);
    expect(test.body.sentTo).toBe('owner@dev.test');
    expect(t.emails.at(-1)?.subject).toMatch(/^\[Test\] Skyline Developments/);

    const reset = await http().delete('/v1/payment-reminders/templates/email/before').set(dev.h).expect(200);
    expect(reset.body.edited).toBe(false);

    // Schedule: one rule per day.
    await http()
      .put('/v1/payment-reminders/config')
      .set(dev.h)
      .send({ rules: [{ offsetDays: -3, channels: ['email'] }, { offsetDays: -3, channels: ['sms'] }] })
      .expect(400);
    const cfg = await http()
      .put('/v1/payment-reminders/config')
      .set(dev.h)
      .send({ rules: [{ offsetDays: -14, channels: ['email'] }, { offsetDays: 1, channels: ['sms', 'email'] }] })
      .expect(200);
    expect(cfg.body.rules).toHaveLength(2);
  });

  it('runs every developer from the cron endpoint with the secret', async () => {
    const dev = await createDeveloper('owner@dev.test', 'Skyline Developments');
    await createOwner('owner@agency.test', 'Alpha Realty');
    await http().get('/v1/cron/payment-reminders').expect(401);
    await http().get('/v1/cron/payment-reminders').set('Authorization', 'Bearer wrong').expect(401);
    const res = await http()
      .get('/v1/cron/payment-reminders')
      .set('Authorization', `Bearer ${CRON}`)
      .expect(200);
    expect(res.body.tenants).toBe(1);

    // "Run now" for one developer uses today's date.
    const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
    await http()
      .post('/v1/payment-plans')
      .set(dev.h)
      .send(plan({ installments: [{ label: 'Installment 1', dueDate: today, amount: 10_000 }] }))
      .expect(201);
    const run = await http().post('/v1/payment-reminders/run').set(dev.h).expect(200);
    expect(run.body.sent).toBe(1);
  });
});
