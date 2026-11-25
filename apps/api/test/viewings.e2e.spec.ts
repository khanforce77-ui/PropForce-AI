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

/** A UAE date a few days ahead (YYYY-MM-DD) that is a working day (not Sunday). */
function workingDay(daysAhead: number) {
  const d = new Date(Date.now() + daysAhead * 86_400_000 + 4 * 3_600_000);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const at = (day: string, hm: string) => `${day}T${hm}:00+04:00`;

describe('viewings', () => {
  it('books, blocks clashing times, moves a lead to Viewing and records the timeline', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const p = await listing(o.h);
    const l = await lead(o.h);
    const day = workingDay(3);

    const v = await http()
      .post('/v1/viewings')
      .set(o.h)
      .send({ leadId: l.id, propertyId: p.id, startsAt: at(day, '10:00') })
      .expect(201);
    expect(v.body).toMatchObject({
      status: 'confirmed',
      agent: { id: o.membershipId },
      property: { id: p.id },
    });
    expect(new Date(v.body.endsAt).getTime() - new Date(v.body.startsAt).getTime()).toBe(
      30 * 60_000,
    );

    // 10:30 is inside the 15-minute travel buffer; 10:45 is fine.
    const clash = await http()
      .post('/v1/viewings')
      .set(o.h)
      .send({ leadId: l.id, propertyId: p.id, startsAt: at(day, '10:30') })
      .expect(409);
    expect(clash.body.code).toBe('SLOT_CONFLICT');
    await http()
      .post('/v1/viewings')
      .set(o.h)
      .send({ leadId: l.id, propertyId: p.id, startsAt: at(day, '10:45'), status: 'requested' })
      .expect(201);

    const detail = await http().get(`/v1/leads/${l.id}`).set(o.h).expect(200);
    expect(detail.body.stage).toBe('viewing');
    expect(
      detail.body.activities.some((a: { body: string | null }) =>
        a.body?.startsWith(`Viewing confirmed for ${p.reference}`),
      ),
    ).toBe(true);

    const slots = await http().get(`/v1/viewings/availability?date=${day}`).set(o.h).expect(200);
    const starts = slots.body.slots.map((s: { start: string }) => new Date(s.start).getTime());
    expect(starts).toContain(new Date(at(day, '09:00')).getTime());
    expect(starts).not.toContain(new Date(at(day, '10:00')).getTime());
    expect(starts).not.toContain(new Date(at(day, '11:00')).getTime());
    expect(starts).toContain(new Date(at(day, '11:30')).getTime());

    const week = await http()
      .get(
        `/v1/viewings?from=${encodeURIComponent(at(day, '00:00'))}&to=${encodeURIComponent(at(workingDay(10), '00:00'))}`,
      )
      .set(o.h)
      .expect(200);
    expect(week.body.data.map((x: { status: string }) => x.status)).toEqual([
      'confirmed',
      'requested',
    ]);
  });

  it('reschedules with conflict checks and follows the status rules', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const p = await listing(o.h);
    const l = await lead(o.h);
    const day = workingDay(2);
    const book = (hm: string) =>
      http()
        .post('/v1/viewings')
        .set(o.h)
        .send({ leadId: l.id, propertyId: p.id, startsAt: at(day, hm) });
    const a = (await book('09:00').expect(201)).body;
    const b = (await book('12:00').expect(201)).body;

    await http()
      .patch(`/v1/viewings/${b.id}`)
      .set(o.h)
      .send({ startsAt: at(day, '09:15') })
      .expect(409);
    const moved = await http()
      .patch(`/v1/viewings/${b.id}`)
      .set(o.h)
      .send({ startsAt: at(day, '15:00'), durationMinutes: 60 })
      .expect(200);
    expect(new Date(moved.body.endsAt).getTime()).toBe(new Date(at(day, '16:00')).getTime());

    // Not happened yet: cannot be completed; cancelling needs a reason and is final.
    await http()
      .post(`/v1/viewings/${a.id}/status`)
      .set(o.h)
      .send({ status: 'completed' })
      .expect(422);
    await http()
      .post(`/v1/viewings/${a.id}/status`)
      .set(o.h)
      .send({ status: 'cancelled' })
      .expect(400);
    await http()
      .post(`/v1/viewings/${a.id}/status`)
      .set(o.h)
      .send({ status: 'cancelled', outcome: 'Client travelling' })
      .expect(201);
    await http()
      .post(`/v1/viewings/${a.id}/status`)
      .set(o.h)
      .send({ status: 'confirmed' })
      .expect(422);
    // The cancelled time is free again.
    await book('09:00').expect(201);

    // A viewing in the past can be completed.
    await t.owner.viewing.update({
      where: { id: moved.body.id },
      data: {
        startsAt: new Date(Date.now() - 7_200_000),
        endsAt: new Date(Date.now() - 3_600_000),
      },
    });
    const done = await http()
      .post(`/v1/viewings/${moved.body.id}/status`)
      .set(o.h)
      .send({ status: 'completed', outcome: 'Liked it, wants a second visit' })
      .expect(201);
    expect(done.body).toMatchObject({
      status: 'completed',
      outcome: 'Liked it, wants a second visit',
    });
  });

  it('agents book only on their own leads and see only their viewings; agencies are isolated', async () => {
    const o = await createOwner('owner@a.test', 'Alpha Realty');
    const agent = await inviteNew(o, 'agent@a.test', 'agent');
    const p = await listing(o.h);
    const ownerLead = await lead(o.h);
    const agentLead = await lead(agent.h);
    const day = workingDay(4);

    await http()
      .post('/v1/viewings')
      .set(agent.h)
      .send({ leadId: ownerLead.id, propertyId: p.id, startsAt: at(day, '10:00') })
      .expect(404);
    await http()
      .post('/v1/viewings')
      .set(agent.h)
      .send({
        leadId: agentLead.id,
        propertyId: p.id,
        startsAt: at(day, '10:00'),
        agentMembershipId: o.membershipId,
      })
      .expect(403);
    const mine = await http()
      .post('/v1/viewings')
      .set(agent.h)
      .send({ leadId: agentLead.id, propertyId: p.id, startsAt: at(day, '10:00') })
      .expect(201);
    expect(mine.body.agent.id).toBe(agent.membershipId);
    await http()
      .post('/v1/viewings')
      .set(o.h)
      .send({ leadId: ownerLead.id, propertyId: p.id, startsAt: at(day, '10:00') })
      .expect(201); // different agent, same time: fine

    const range = `from=${encodeURIComponent(at(day, '00:00'))}&to=${encodeURIComponent(at(day, '23:59'))}`;
    const agentView = await http().get(`/v1/viewings?${range}`).set(agent.h).expect(200);
    expect(agentView.body.data).toHaveLength(1);
    const ownerView = await http().get(`/v1/viewings?${range}`).set(o.h).expect(200);
    expect(ownerView.body.data).toHaveLength(2);

    const other = await createOwner('owner@b.test', 'Beta Homes');
    await http().get(`/v1/viewings/${mine.body.id}`).set(other.h).expect(404);
    const otherView = await http().get(`/v1/viewings?${range}`).set(other.h).expect(200);
    expect(otherView.body.data).toHaveLength(0);
    // Past times and draft listings are refused.
    const draft = await listing(o.h, {}, { draft: true });
    await http()
      .post('/v1/viewings')
      .set(o.h)
      .send({ leadId: ownerLead.id, propertyId: draft.id, startsAt: at(day, '15:00') })
      .expect(422);
    await http()
      .post('/v1/viewings')
      .set(o.h)
      .send({ leadId: ownerLead.id, propertyId: p.id, startsAt: '2020-01-01T10:00:00+04:00' })
      .expect(422);
  });
});
