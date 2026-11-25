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

const buyer = {
  intent: 'buy',
  emirate: 'Dubai',
  communities: ['Dubai Marina'],
  propertyTypes: ['apartment'],
  bedroomsMin: 2,
  bedroomsMax: 2,
  budgetMax: 2_000_000,
};

describe('lead to listing matching', () => {
  it('suggests only live listings that fit, best first, with reasons and gaps', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const best = await listing(o.h, { price: 1_900_000 });
    const over = await listing(o.h, { price: 2_150_000 }); // 7.5% over: shown with a gap
    const elsewhere = await listing(o.h, { community: 'JLT', price: 1_800_000 });
    await listing(o.h, { price: 2_500_000 }); // 25% over budget
    await listing(o.h, { propertyType: 'villa' });
    await listing(o.h, { listingType: 'rent', price: 120_000 });
    await listing(o.h, { bedrooms: 4 });
    await listing(o.h, { emirate: 'Abu Dhabi', community: 'Al Reem Island' });
    await listing(o.h, {}, { draft: true });
    const l = await lead(o.h, buyer);

    const res = await http().get(`/v1/leads/${l.id}/matches`).set(o.h).expect(200);
    expect(res.body.data.map((m: { listing: { id: string } }) => m.listing.id)).toEqual([
      best.id,
      over.id,
      elsewhere.id,
    ]);
    expect(res.body.data[0]).toMatchObject({
      score: 100,
      reasons: ['In Dubai Marina', 'Type: apartment', '2 bed', 'AED 1,900,000, within budget'],
      gaps: [],
      suggested: false,
    });
    expect(res.body.data[1].gaps).toEqual(['AED 2,150,000, 8% over budget']);
    expect(res.body.data[2].gaps).toEqual(['Not in Dubai Marina']);
  });

  it('compares monthly rents as yearly and does not match owners', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const monthly = await listing(o.h, {
      listingType: 'rent',
      price: 9_000,
      rentPeriod: 'monthly',
    });
    await listing(o.h, { listingType: 'rent', price: 15_000, rentPeriod: 'monthly' });
    const renter = await lead(o.h, { intent: 'rent', budgetMax: 120_000 });
    const res = await http().get(`/v1/leads/${renter.id}/matches`).set(o.h).expect(200);
    expect(res.body.data.map((m: { listing: { id: string } }) => m.listing.id)).toEqual([
      monthly.id,
    ]);
    expect(res.body.data[0].reasons).toContain('AED 108,000 a year, within budget');

    const seller = await lead(o.h, { intent: 'sell' });
    const none = await http().get(`/v1/leads/${seller.id}/matches`).set(o.h).expect(200);
    expect(none.body.data).toEqual([]);
  });

  it('finds open leads for a listing; agents see only their own leads', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const p = await listing(o.h, { price: 1_900_000 });
    const mine = await lead(o.h, buyer);
    const theirs = await lead(agent.h, { ...buyer, budgetMax: 1_950_000 });
    await lead(o.h, { ...buyer, budgetMax: 1_000_000 }); // too far under the price
    const closed = await lead(o.h, buyer);
    await http()
      .post(`/v1/leads/${closed.id}/stage`)
      .set(o.h)
      .send({ stage: 'lost', lostReason: 'Bought elsewhere' })
      .expect(200);

    const all = await http().get(`/v1/properties/${p.id}/matches`).set(o.h).expect(200);
    expect(all.body.data.map((m: { lead: { id: string } }) => m.lead.id).sort()).toEqual(
      [mine.id, theirs.id].sort(),
    );
    const own = await http().get(`/v1/properties/${p.id}/matches`).set(agent.h).expect(200);
    expect(own.body.data.map((m: { lead: { id: string } }) => m.lead.id)).toEqual([theirs.id]);
    // An agent cannot ask for matches on someone else's lead.
    await http().get(`/v1/leads/${mine.id}/matches`).set(agent.h).expect(404);
  });

  it('records a suggestion on the lead timeline once and keeps agencies apart', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const other = await createOwner('owner@b.test', 'Beta Homes');
    const p = await listing(o.h, { price: 1_900_000 });
    const theirListing = await listing(other.h, { price: 1_900_000 });
    const l = await lead(o.h, buyer);
    const url = `/v1/leads/${l.id}/matches/${p.id}/suggested`;
    await http().post(url).set(o.h).expect(201);
    await http().post(url).set(o.h).expect(201);
    const detail = await http().get(`/v1/leads/${l.id}`).set(o.h).expect(200);
    const notes = detail.body.activities.filter((a: { body: string | null }) =>
      a.body?.startsWith('Suggested listing'),
    );
    expect(notes).toHaveLength(1);
    const res = await http().get(`/v1/leads/${l.id}/matches`).set(o.h).expect(200);
    expect(res.body.data[0]).toMatchObject({ listing: { id: p.id }, suggested: true });
    expect(res.body.data).toHaveLength(1);

    await http()
      .post(`/v1/leads/${l.id}/matches/${theirListing.id}/suggested`)
      .set(o.h)
      .expect(404);
    await http().get(`/v1/leads/${l.id}/matches`).set(other.h).expect(404);
    await http().get(`/v1/properties/${p.id}/matches`).set(other.h).expect(404);
  });
});
