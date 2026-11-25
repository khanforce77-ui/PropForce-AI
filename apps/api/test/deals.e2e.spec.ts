import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { actors } from './actors';
import { createTestApp, resetDatabase, resetRateLimits, type TestApp } from './helpers';

let t: TestApp;
const { http, createOwner, inviteNew, listing, lead } = actors(() => t);

beforeAll(async () => {
  t = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '1000' });
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await resetDatabase(t.owner);
  resetRateLimits(t.app);
  t.emails.length = 0;
});

describe('deals and commissions', () => {
  it('runs a sale from offer to completion: commission, checklist, lead won, listing sold', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const p = await listing(o.h, { price: 2_000_000 });
    const l = await lead(o.h);

    const created = await http()
      .post('/v1/deals')
      .set(o.h)
      .send({
        type: 'sale',
        leadId: l.id,
        propertyId: p.id,
        price: 1_950_000,
        commissionPercent: 2,
      })
      .expect(201);
    const d = created.body;
    expect(d).toMatchObject({
      reference: 'DL-00001',
      stage: 'offer_made',
      contact: { id: l.contactId },
      commission: { gross: 39_000, vat: 1_950, total: 40_950, agencyPercent: 0 },
    });
    expect(d.splits).toEqual([
      expect.objectContaining({ membershipId: o.membershipId, percent: 100 }),
    ]);

    // Split: 50% the owner, 20% the agent, 10% a co-broker; the agency keeps 20%.
    await http().post(`/v1/deals/${d.id}/splits`).set(agent.h).send({ splits: [] }).expect(403);
    await http()
      .post(`/v1/deals/${d.id}/splits`)
      .set(o.h)
      .send({
        splits: [
          { membershipId: o.membershipId, percent: 70 },
          { partyName: 'X', percent: 40 },
        ],
      })
      .expect(400);
    const split = await http()
      .post(`/v1/deals/${d.id}/splits`)
      .set(o.h)
      .send({
        splits: [
          { membershipId: o.membershipId, percent: 50 },
          { membershipId: agent.membershipId, percent: 20 },
          { partyName: 'Gulf Co-Broker LLC', percent: 10 },
        ],
      })
      .expect(200);
    expect(split.body.commission).toMatchObject({ agencyPercent: 20, agencyAmount: 7_800 });
    expect(split.body.commission.splits.map((s: { amount: number }) => s.amount)).toEqual([
      19_500, 7_800, 3_900,
    ]);

    // The agent can see the deal (they share the commission) but not change it.
    const seen = await http().get(`/v1/deals`).set(agent.h).expect(200);
    expect(seen.body.data).toHaveLength(1);
    await http()
      .post(`/v1/deals/${d.id}/stage`)
      .set(agent.h)
      .send({ stage: 'mou_signed' })
      .expect(403);

    const detail = await http().get(`/v1/deals/${d.id}`).set(o.h).expect(200);
    expect(detail.body.tasks).toHaveLength(7);
    const task = detail.body.tasks[0];
    const ticked = await http()
      .patch(`/v1/deals/${d.id}/tasks/${task.id}`)
      .set(o.h)
      .send({ done: true })
      .expect(200);
    expect(ticked.body.doneAt).not.toBeNull();

    await http()
      .post(`/v1/deals/${d.id}/stage`)
      .set(o.h)
      .send({ stage: 'ejari_registered' })
      .expect(422);
    await http().post(`/v1/deals/${d.id}/stage`).set(o.h).send({ stage: 'mou_signed' }).expect(200);
    const done = await http()
      .post(`/v1/deals/${d.id}/stage`)
      .set(o.h)
      .send({ stage: 'completed' })
      .expect(200);
    expect(done.body.closedAt).not.toBeNull();
    const leadAfter = await http().get(`/v1/leads/${l.id}`).set(o.h).expect(200);
    expect(leadAfter.body.stage).toBe('won');
    const pAfter = await http().get(`/v1/properties/${p.id}`).set(o.h).expect(200);
    expect(pAfter.body.status).toBe('sold');

    const paid = await http()
      .post(`/v1/deals/${d.id}/commission`)
      .set(o.h)
      .send({ status: 'received', invoiceNumber: 'INV-1001' })
      .expect(200);
    expect(paid.body).toMatchObject({ commissionStatus: 'received', invoiceNumber: 'INV-1001' });
    expect(paid.body.commissionReceivedAt).not.toBeNull();

    const summary = await http().get('/v1/deals/summary?type=sale').set(o.h).expect(200);
    expect(summary.body.stages.completed).toEqual({
      count: 1,
      value: 1_950_000,
      commission: 39_000,
    });
  });

  it('rental deals use their own stages; falling through needs a reason; agencies are isolated', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const rent = await listing(o.h, { listingType: 'rent', price: 120_000 });
    const sale = await listing(o.h);
    const l = await lead(o.h, { intent: 'rent' });

    await http()
      .post('/v1/deals')
      .set(o.h)
      .send({ type: 'rental', leadId: l.id, propertyId: sale.id, price: 100_000 })
      .expect(422);
    const d = (
      await http()
        .post('/v1/deals')
        .set(o.h)
        .send({
          type: 'rental',
          leadId: l.id,
          propertyId: rent.id,
          price: 115_000,
          commissionAmount: 5_750,
        })
        .expect(201)
    ).body;
    expect(d.commission).toMatchObject({ gross: 5_750, vat: 287.5 });
    await http().post(`/v1/deals/${d.id}/stage`).set(o.h).send({ stage: 'mou_signed' }).expect(422);
    await http()
      .post(`/v1/deals/${d.id}/stage`)
      .set(o.h)
      .send({ stage: 'ejari_registered' })
      .expect(200);
    await http()
      .post(`/v1/deals/${d.id}/stage`)
      .set(o.h)
      .send({ stage: 'fallen_through' })
      .expect(400);
    const lost = await http()
      .post(`/v1/deals/${d.id}/stage`)
      .set(o.h)
      .send({ stage: 'fallen_through', reason: 'Landlord withdrew' })
      .expect(200);
    expect(lost.body).toMatchObject({ lostReason: 'Landlord withdrew' });
    const p = await http().get(`/v1/properties/${rent.id}`).set(o.h).expect(200);
    expect(p.body.status).toBe('active');

    const other = await createOwner('owner@b.test', 'Beta Homes');
    await http().get(`/v1/deals/${d.id}`).set(other.h).expect(404);
    expect((await http().get('/v1/deals').set(other.h).expect(200)).body.data).toHaveLength(0);
    await http()
      .post('/v1/deals')
      .set(other.h)
      .send({ type: 'rental', leadId: l.id, price: 1 })
      .expect(404);
  });
});
