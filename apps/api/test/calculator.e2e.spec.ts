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
  t = await createTestApp({
    AUTH_RATE_LIMIT_PER_MINUTE: '1000',
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

describe('cost calculator', () => {
  it('estimates from PropForce samples, marked unverified, and in AED', async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const res = await http()
      .post('/v1/calculator/estimate')
      .set(a.h)
      .send({ emirate: 'Dubai', calculator: 'ready_sale', price: 2_000_000, brokerSplitPct: 40 })
      .expect(200);
    expect(res.body.label).toBe('Estimate');
    const dld = res.body.items.find((i: { code: string }) => i.code === 'dld_transfer');
    expect(dld).toMatchObject({ fee: 80_580, total: 80_580 });
    expect(dld.rule).toMatchObject({ status: 'unverified_sample', isOverride: false });
    expect(res.body.commission).toEqual({ agency: 40_000, brokerSplitPct: 40, broker: 16_000 });
    expect(res.body.unverifiedCount).toBe(res.body.items.length);

    const rent = await http()
      .post('/v1/calculator/estimate')
      .set(a.h)
      .send({ emirate: 'Abu Dhabi', calculator: 'rental', annualRent: 100_000 })
      .expect(200);
    expect(rent.body.items.map((i: { code: string }) => i.code).sort()).toEqual([
      'agency_commission_rent',
      'municipality_fee',
      'security_deposit',
      'tawtheeq',
    ]);
    await http()
      .post('/v1/calculator/estimate')
      .set(a.h)
      .send({ emirate: 'Dubai', calculator: 'timeshare', price: 1 })
      .expect(400);
  });

  it("lets an agency verify its own fee values without touching other agencies'", async () => {
    const a = await createAgency('a@example.test', 'Alpha Homes');
    const b = await createAgency('b@example.test', 'Bravo Realty');
    await http()
      .put('/v1/calculator/rules')
      .set(a.h)
      .send({
        emirate: 'Dubai',
        code: 'agency_commission_sale',
        ratePct: 1.5,
        amount: null,
        source: 'Our standard terms, 2026',
        verified: true,
      })
      .expect(200);
    const rules = (
      await http().get('/v1/calculator/rules').query({ emirate: 'Dubai' }).set(a.h).expect(200)
    ).body.data;
    expect(rules.find((r: { code: string }) => r.code === 'agency_commission_sale')).toMatchObject({
      ratePct: 1.5,
      status: 'verified',
      isOverride: true,
      template: { ratePct: 2 },
    });
    const est = async (h: Record<string, string>) =>
      (
        await http()
          .post('/v1/calculator/estimate')
          .set(h)
          .send({ emirate: 'Dubai', calculator: 'ready_sale', price: 1_000_000 })
          .expect(200)
      ).body.commission.agency as number;
    expect(await est(a.h)).toBe(15_000);
    expect(await est(b.h)).toBe(20_000);

    await http()
      .put('/v1/calculator/rules')
      .set(a.h)
      .send({
        emirate: 'Dubai',
        code: 'made_up',
        ratePct: 1,
        amount: null,
        source: 'x y z',
        verified: false,
      })
      .expect(404);
    await http().delete('/v1/calculator/rules/Dubai/agency_commission_sale').set(a.h).expect(204);
    expect(await est(a.h)).toBe(20_000);
    const audit = await t.owner.auditLog.findMany({
      where: { tenantId: a.tenantId, entityType: 'fee_rule' },
    });
    expect(audit.map((x) => x.action).sort()).toEqual(['fee_rule.reset', 'fee_rule.set']);
  });
});

describe('ROI and affordability', () => {
  it('works out buy-to-let return with buying costs from the fee rules', async () => {
    const a = await createAgency('roi@example.test', 'Roi Homes');
    const res = await http()
      .post('/v1/calculator/roi')
      .set(a.h)
      .send({
        emirate: 'Dubai',
        price: 2_000_000,
        annualRent: 140_000,
        serviceChargeYearly: 20_000,
        mortgage: { interestRatePct: 4.5, years: 25 },
      })
      .expect(200);
    expect(res.body.label).toBe('Estimate');
    expect(res.body.yields.grossPct).toBe(7);
    expect(res.body.buyingCosts).toBeGreaterThan(80_000);
    expect(res.body.buyingCostItems.length).toBeGreaterThan(0);
    expect(res.body.unverifiedCount).toBeGreaterThan(0);
    expect(res.body.mortgage).not.toBeNull();
    expect(res.body.projection).toHaveLength(10);
    // Cash put in = down payment + buying costs.
    expect(res.body.cashInvested).toBeGreaterThan(400_000);

    await http()
      .post('/v1/calculator/roi')
      .set(a.h)
      .send({ emirate: 'Dubai', price: -1, annualRent: 1 })
      .expect(400);
  });

  it('caps borrowing at half of income', async () => {
    const a = await createAgency('aff@example.test', 'Aff Homes');
    const res = await http()
      .post('/v1/calculator/affordability')
      .set(a.h)
      .send({ monthlyIncome: 40_000, monthlyDebts: 5_000 })
      .expect(200);
    expect(res.body.maxMonthlyPayment).toBe(15_000);
    expect(res.body.maxLoan).toBeGreaterThan(2_000_000);
    expect(res.body.maxPrice).toBeGreaterThan(res.body.maxLoan);
  });
});
