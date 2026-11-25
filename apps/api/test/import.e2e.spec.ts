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

describe('bulk import', () => {
  it('previews contacts without writing, then imports them with leads, skipping duplicates', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    await lead(o.h); // an existing contact, phone +971501000001
    const rows = [
      {
        'Full Name': 'Omar Buyer',
        Mobile: '050 222 3333',
        Email: 'omar@example.test',
        'Looking to': 'Buyer',
        Community: 'Dubai Marina; JBR',
        'Property Type': 'Flat',
        Bedrooms: '2',
        'Max Budget': 'AED 2,500,000',
        Emirate: 'dubai',
      },
      { 'First name': 'Lina', 'Last name': 'Tenant', Phone: '+971 55 444 5555' },
      { 'Full Name': 'Again Omar', Mobile: '+971502223333' }, // same phone as row 1
      { 'Full Name': 'Existing', Mobile: '+971501000001' },
      { 'Full Name': 'No way to reach' },
      { 'Full Name': 'Bad intent', Phone: '0507778888', Intent: 'maybe' },
    ];

    const preview = await http()
      .post('/v1/import/contacts')
      .set(o.h)
      .send({ rows, dryRun: true })
      .expect(200);
    expect(preview.body.summary).toEqual({ ready: 2, created: 0, duplicate: 2, error: 2 });
    expect(preview.body.results[5].errors).toEqual(['Intent: "maybe" is not recognised']);
    const before = await http().get('/v1/contacts').set(o.h).expect(200);
    expect(before.body.data).toHaveLength(1);

    const done = await http()
      .post('/v1/import/contacts')
      .set(o.h)
      .send({ rows, dryRun: false })
      .expect(200);
    expect(done.body.summary).toEqual({ ready: 0, created: 2, duplicate: 2, error: 2 });
    const omar = await http().get(`/v1/contacts/${done.body.results[0].id}`).set(o.h).expect(200);
    expect(omar.body).toMatchObject({ phoneE164: '+971502223333', source: 'import' });
    // Imported contacts carry no consent: nobody is messaged until it is recorded.
    expect(omar.body.consentState.every((c: { status: string }) => c.status === 'unknown')).toBe(
      true,
    );
    const leads = await http().get('/v1/leads').set(o.h).expect(200);
    const imported = leads.body.data.find(
      (l: { contact: { id: string } }) => l.contact.id === omar.body.id,
    );
    expect(imported).toMatchObject({
      intent: 'buy',
      source: 'import',
      emirate: 'Dubai',
      communities: ['Dubai Marina', 'JBR'],
      propertyTypes: ['apartment'],
      bedroomsMin: 2,
      bedroomsMax: 2,
      budgetMax: '2500000',
    });
    const logs = await http().get('/v1/audit-logs?entityType=contact').set(o.h).expect(200);
    expect(logs.body.data[0]).toMatchObject({ action: 'import.contacts' });
  });

  it('imports listings as drafts, refuses duplicate references and checks the agent column', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const existing = await listing(o.h, { reference: 'AR-1' });
    expect(existing.reference).toBe('AR-1');
    const rows = [
      {
        Reference: 'AR-2',
        Purpose: 'For Rent',
        Type: 'Villa',
        City: 'Dubai',
        Location: 'Arabian Ranches',
        Beds: '4',
        Baths: '5',
        'Size (sqft)': '3,800',
        Price: '320000',
        'Agent email': 'agent@a.test',
      },
      { Reference: 'AR-1', Purpose: 'sale', Type: 'apartment', City: 'Dubai' },
      { Reference: 'AR-3', Purpose: 'sale', Type: 'castle', City: 'Dubai' },
      { Reference: 'AR-4', Purpose: 'sale', Type: 'apartment', City: 'Dubai', Agent: 'x@y.test' },
    ];
    const res = await http()
      .post('/v1/import/listings')
      .set(o.h)
      .send({ rows, dryRun: false })
      .expect(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual([
      'created',
      'duplicate',
      'error',
      'error',
    ]);
    expect(res.body.results[3].errors).toEqual(['Agent: no active member with email x@y.test']);
    const p = await http().get(`/v1/properties/${res.body.results[0].id}`).set(o.h).expect(200);
    expect(p.body).toMatchObject({
      status: 'draft',
      listingType: 'rent',
      rentPeriod: 'yearly',
      propertyType: 'villa',
      community: 'Arabian Ranches',
      bedrooms: 4,
      areaSqft: '3800',
      assignedMembershipId: agent.membershipId,
    });

    // Agents cannot import rows for other agents.
    const asAgent = await http()
      .post('/v1/import/listings')
      .set(agent.h)
      .send({
        rows: [
          {
            Reference: 'AR-9',
            Purpose: 'sale',
            Type: 'apartment',
            City: 'Dubai',
            Agent: 'owner@a.test',
          },
        ],
        dryRun: true,
      })
      .expect(200);
    expect(asAgent.body.results[0].errors).toEqual([
      'Agent: only managers can import rows for other agents',
    ]);
  });

  it('rejects oversized files', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const rows = Array.from({ length: 501 }, (_, i) => ({ Name: `C${i}` }));
    await http().post('/v1/import/contacts').set(o.h).send({ rows }).expect(400);
  });
});
