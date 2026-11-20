import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type PrismaClient } from '../src';
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
let bProjectId: string;
let bPropertyId: string;

const listing = (tenant: SeededTenant, reference: string) => ({
  tenantId: tenant.agencyId,
  reference,
  listingType: 'sale' as const,
  propertyType: 'apartment' as const,
  emirate: 'Dubai',
  createdBy: tenant.ownerUserId,
});

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
  const project = await owner.project.create({
    data: { tenantId: b.agencyId, name: 'Bravo Towers', emirate: 'Dubai' },
  });
  bProjectId = project.id;
  const property = await owner.property.create({
    data: { ...listing(b, 'B-1'), projectId: project.id },
  });
  bPropertyId = property.id;
  await owner.propertyPermit.create({
    data: {
      tenantId: b.agencyId,
      propertyId: property.id,
      authority: 'DLD',
      permitNumber: '7100000001',
      validUntil: new Date('2030-01-01'),
    },
  });
});

describe('inventory tables', () => {
  it('are invisible without tenant context', async () => {
    expect(await app.project.count()).toBe(0);
    expect(await app.property.count()).toBe(0);
    expect(await app.propertyPermit.count()).toBe(0);
  });

  it('hide another agency’s projects, listings and permits', async () => {
    const seen = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      projects: await tx.project.count(),
      properties: await tx.property.count(),
      permits: await tx.propertyPermit.count(),
      byId: await tx.property.findUnique({ where: { id: bPropertyId } }),
    }));
    expect(seen).toEqual({ projects: 0, properties: 0, permits: 0, byId: null });
  });

  it('refuse a listing that points at another agency’s project or agent', async () => {
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.property.create({ data: { ...listing(a, 'A-1'), projectId: bProjectId } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.property.create({
          data: { ...listing(a, 'A-2'), assignedMembershipId: b.membershipId },
        }),
      ),
    ).rejects.toThrow();
    // Even the privileged owner connection cannot mix tenants: the composite keys refuse it.
    await expect(
      owner.property.create({ data: { ...listing(a, 'A-3'), projectId: bProjectId } }),
    ).rejects.toThrow();
  });

  it('refuse a permit on another agency’s listing', async () => {
    await expect(
      owner.propertyPermit.create({
        data: {
          tenantId: a.agencyId,
          propertyId: bPropertyId,
          authority: 'DLD',
          permitNumber: 'X1',
          validUntil: new Date('2030-01-01'),
        },
      }),
    ).rejects.toThrow();
  });

  it('cannot update or delete another agency’s listings', async () => {
    const result = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      updated: await tx.property.updateMany({ where: { id: bPropertyId }, data: { price: 1 } }),
      deleted: await tx.property.deleteMany({}),
    }));
    expect(result).toEqual({ updated: { count: 0 }, deleted: { count: 0 } });
    expect(await owner.property.count({ where: { tenantId: b.agencyId } })).toBe(1);
  });

  it('enforce sane numbers in the database', async () => {
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.property.create({ data: { ...listing(a, 'A-4'), price: -5 } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.property.create({ data: { ...listing(a, 'A-5'), rentPeriod: 'yearly' } }),
      ),
    ).rejects.toThrow();
  });

  it('keep references unique per agency only', async () => {
    await withTenant(app, { tenantId: a.agencyId }, (tx) =>
      tx.property.create({ data: listing(a, 'B-1') }),
    );
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.property.create({ data: listing(a, 'B-1') }),
      ),
    ).rejects.toThrow(/unique/i);
  });
});
