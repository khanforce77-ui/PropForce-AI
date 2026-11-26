import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@propforce/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PRISMA } from '../src/database/database.module';
import { actors } from './actors';
import { createTestApp, resetDatabase, resetRateLimits, type TestApp } from './helpers';

let t: TestApp;
let app: INestApplication;
const http = () => request(app.getHttpServer());
const { createOwner, inviteNew } = actors(() => t);

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
  app = t.app;
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.owner);
  await t.owner.$executeRawUnsafe(
    `UPDATE "billing_plan" SET price_monthly_aed = NULL, active = true,
       seat_limit = CASE code WHEN 'professional' THEN 10 ELSE seat_limit END`,
  );
  resetRateLimits(app);
  t.emails.length = 0;
});

describe('billing', () => {
  it('shows plan and usage, sets caps (owner only), and refuses checkout until a provider exists', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const admin = await inviteNew(o, 'admin@a.test', 'admin');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');

    const res = await http().get('/v1/billing').set(o.h).expect(200);
    expect(res.body.subscription).toMatchObject({
      planCode: 'trial',
      status: 'trialing',
      managedBy: null,
    });
    expect(res.body.subscription.trialEndsAt).toBeTruthy();
    expect(res.body.plans.map((p: { code: string }) => p.code)).toEqual([
      'trial',
      'starter',
      'professional',
      'agency',
      'enterprise',
    ]);
    expect(res.body.usage.seats.used).toBe(3);
    expect(res.body.provider).toEqual({ configured: false, name: null });

    // Admin can see billing but not change it; agents cannot see it.
    await http().get('/v1/billing').set(admin.h).expect(200);
    await http().get('/v1/billing').set(agent.h).expect(403);
    const caps = { caps: [{ meter: 'whatsapp_messages', monthlyLimit: 500, action: 'warn' }] };
    await http().put('/v1/billing/spending-caps').set(admin.h).send(caps).expect(403);
    await http().put('/v1/billing/spending-caps').set(o.h).send(caps).expect(200);
    const after = await http().get('/v1/billing').set(o.h).expect(200);
    expect(after.body.caps).toEqual([
      { meter: 'whatsapp_messages', monthlyLimit: 500, action: 'warn', used: 0, reached: false },
    ]);
    await http()
      .put('/v1/billing/spending-caps')
      .set(o.h)
      .send({ caps: [{ meter: 'whatsapp_messages', monthlyLimit: null }] })
      .expect(200);
    expect((await http().get('/v1/billing').set(o.h)).body.caps).toEqual([]);

    // Unpriced plan, then priced plan with no provider.
    expect(
      (await http().post('/v1/billing/checkout').set(o.h).send({ planCode: 'starter' }).expect(409))
        .body.code,
    ).toBe('PLAN_NOT_PRICED');
    await t.owner.billingPlan.update({
      where: { code: 'starter' },
      data: { priceMonthlyAed: 499 },
    });
    expect(
      (await http().post('/v1/billing/checkout').set(o.h).send({ planCode: 'starter' }).expect(503))
        .body.code,
    ).toBe('BILLING_NOT_CONFIGURED');
    await http().post('/v1/billing/checkout').set(o.h).send({ planCode: 'nope' }).expect(404);
  });

  it('lets the platform admin price plans and set a subscription, which applies the limits', async () => {
    const root = await createOwner('root@platform.test', 'Platform HQ');
    await t.owner.user.update({ where: { id: root.userId }, data: { isPlatformAdmin: true } });
    const a = await createOwner('owner@a.test', 'Alpha Realty');

    await http().get('/v1/platform/billing').set(a.auth).expect(403);
    await http().get('/v1/platform/billing/usage').set(a.auth).expect(403);
    const usage = await http().get('/v1/platform/billing/usage').set(root.auth).expect(200);
    expect(usage.body.agencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tenantId: a.tenantId,
          name: 'Alpha Realty',
          aiReplies: 0,
          aiTokens: 0,
          whatsappOutbound: 0,
          voiceCalls: 0,
          mrrAed: 0,
        }),
      ]),
    );
    await http()
      .put('/v1/platform/billing/plans/professional')
      .set(a.auth)
      .send({ priceMonthlyAed: 1 })
      .expect(403);

    const plan = await http()
      .put('/v1/platform/billing/plans/professional')
      .set(root.auth)
      .send({ priceMonthlyAed: 1499, seatLimit: 12 })
      .expect(200);
    expect(plan.body).toMatchObject({ code: 'professional', priceMonthlyAed: 1499, seatLimit: 12 });

    // A tenant cannot change the catalogue directly, even through the database role.
    const changed = await app.get<PrismaClient>(PRISMA).billingPlan.updateMany({
      where: { code: 'professional' },
      data: { priceMonthlyAed: 1 },
    });
    expect(changed.count).toBe(0);

    await http()
      .put(`/v1/platform/billing/agencies/${a.tenantId}/subscription`)
      .set(root.auth)
      .send({
        planCode: 'professional',
        status: 'active',
        currentPeriodEnd: '2026-12-31T20:00:00Z',
      })
      .expect(200);
    const agency = await t.owner.agency.findUniqueOrThrow({ where: { id: a.tenantId } });
    expect(agency).toMatchObject({ plan: 'professional', seatLimit: 12, listingLimit: 1000 });

    const mine = await http().get('/v1/billing').set(a.h).expect(200);
    expect(mine.body.subscription).toMatchObject({
      planCode: 'professional',
      status: 'active',
      managedBy: 'manual',
    });
    expect(mine.body.plan.leadBooster).toBe(true);
    expect(mine.body.usage.seats.limit).toBe(12);

    const overview = await http().get('/v1/platform/billing').set(root.auth).expect(200);
    expect(overview.body.metrics).toMatchObject({
      mrrAed: 1499,
      activeUnpriced: 0,
      byStatus: { active: 1, trialing: 0, past_due: 0, cancelled: 0 },
    });
    expect(overview.body.subscriptions).toEqual([
      expect.objectContaining({ agencyName: 'Alpha Realty', planCode: 'professional' }),
    ]);

    const log = await t.owner.auditLog.findFirst({
      where: { tenantId: a.tenantId, action: 'platform.subscription_set' },
    });
    expect(log?.actorType).toBe('platform');
    expect(
      await t.owner.platformAuditLog.count({ where: { action: 'platform.plan_changed' } }),
    ).toBe(1);
  });
});
