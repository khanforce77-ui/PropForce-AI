import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withPlatformAdmin, withUser, type PrismaClient } from '../src';
import {
  createAppClient,
  createOwnerClient,
  resetDatabase,
  seedTenant,
  type SeededTenant,
} from './helpers';

let owner: PrismaClient;
let app: PrismaClient;
let a: SeededTenant;
let b: SeededTenant;
let adminId: string;

beforeAll(() => {
  owner = createOwnerClient();
  app = createAppClient();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});
beforeEach(async () => {
  await resetDatabase(owner);
  a = await seedTenant(owner, 'Alpha');
  b = await seedTenant(owner, 'Bravo');
  for (const t of [a, b]) {
    await owner.property.create({
      data: {
        tenantId: t.agencyId,
        reference: 'R-1',
        listingType: 'sale',
        propertyType: 'villa',
        emirate: 'Dubai',
        createdBy: t.ownerUserId,
      },
    });
  }
  adminId = (
    await owner.user.create({
      data: { email: 'admin@platform.test', fullName: 'Platform Admin', isPlatformAdmin: true },
    })
  ).id;
});

const counts = (tx: Parameters<Parameters<typeof withUser>[2]>[0]) =>
  Promise.all([tx.agency.count(), tx.membership.count(), tx.property.count(), tx.team.count()]);

describe('platform admin visibility', () => {
  it('lets a flagged admin read every agency, membership and listing, but not teams', async () => {
    const [agencies, memberships, properties, teams] = await withPlatformAdmin(
      app,
      { userId: adminId },
      counts,
    );
    expect({ agencies, memberships, properties, teams }).toEqual({
      agencies: 2,
      memberships: 2,
      properties: 2,
      teams: 0,
    });
  });

  it('gives nothing to a user without the flag, even when they opt in', async () => {
    const [agencies, memberships, properties] = await withPlatformAdmin(
      app,
      { userId: a.ownerUserId },
      counts,
    );
    // Only Alpha's owner's own agency and membership, as with any signed-in user.
    expect({ agencies, memberships, properties }).toEqual({
      agencies: 1,
      memberships: 1,
      properties: 0,
    });
  });

  it('does not apply without opting in', async () => {
    const [agencies, , properties] = await withUser(app, { userId: adminId }, counts);
    expect({ agencies, properties }).toEqual({ agencies: 0, properties: 0 });
  });

  it('is read-only', async () => {
    const result = await withPlatformAdmin(app, { userId: adminId }, async (tx) => ({
      agency: await tx.agency.updateMany({ data: { name: 'Hijacked' } }),
      property: await tx.property.updateMany({ data: { title: 'Hijacked' } }),
      deleted: await tx.property.deleteMany({}),
    }));
    expect(result).toEqual({ agency: { count: 0 }, property: { count: 0 }, deleted: { count: 0 } });
    expect(await owner.property.count()).toBe(2);
  });
});
