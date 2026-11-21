import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withPublicPortal, withTenant, type PrismaClient } from '../src';
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

const DAY = 86_400_000;
const future = () => new Date(Date.now() + 10 * DAY);

beforeAll(() => {
  owner = createOwnerClient();
  app = createAppClient();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

async function listing(
  t: SeededTenant,
  reference: string,
  opts: {
    status?: 'draft' | 'active' | 'archived';
    permit?: 'valid' | 'expired' | 'none';
    expiresAt?: Date;
    assigned?: string | null;
    deleted?: boolean;
  } = {},
) {
  const p = await owner.property.create({
    data: {
      tenantId: t.agencyId,
      reference,
      listingType: 'sale',
      propertyType: 'apartment',
      emirate: 'Dubai',
      community: 'Dubai Marina',
      price: 1_500_000,
      areaSqft: 900,
      status: opts.status ?? 'active',
      listingExpiresAt: opts.expiresAt ?? future(),
      assignedMembershipId: opts.assigned === undefined ? t.membershipId : opts.assigned,
      createdBy: t.ownerUserId,
      deletedAt: opts.deleted ? new Date() : null,
    },
  });
  const permit = opts.permit ?? 'valid';
  if (permit !== 'none') {
    await owner.propertyPermit.create({
      data: {
        tenantId: t.agencyId,
        propertyId: p.id,
        authority: 'DLD',
        permitNumber: `${reference}-${t.agencyId.slice(0, 6)}`,
        validUntil: permit === 'valid' ? future() : new Date(Date.now() - 2 * DAY),
      },
    });
  }
  return p;
}

const enquiry = (t: SeededTenant, propertyId: string, membershipId = t.membershipId) => ({
  tenantId: t.agencyId,
  propertyId,
  membershipId,
  fullName: 'Visitor',
  phoneE164: '+971501234567',
  message: 'Is it available?',
  consentContact: true,
  consentText: 'I agree to be contacted',
  consentAt: new Date(),
});

beforeEach(async () => {
  await resetDatabase(owner);
  await owner.$executeRawUnsafe('TRUNCATE "public_rate_hit"');
  a = await seedTenant(owner, 'Alpha');
  b = await seedTenant(owner, 'Bravo');
});

describe('public portal visibility', () => {
  it('shows only published, fresh, permitted, assigned listings from every active agency', async () => {
    const ok = await listing(a, 'A-OK');
    const okB = await listing(b, 'B-OK');
    await listing(a, 'A-DRAFT', { status: 'draft' });
    await listing(a, 'A-ARCH', { status: 'archived' });
    await listing(a, 'A-NOPERMIT', { permit: 'none' });
    await listing(a, 'A-EXPPERMIT', { permit: 'expired' });
    await listing(a, 'A-STALE', { expiresAt: new Date(Date.now() - DAY) });
    await listing(a, 'A-UNASSIGNED', { assigned: null });
    await listing(a, 'A-DELETED', { deleted: true });

    const ids = await withPublicPortal(app, (tx) =>
      tx.property.findMany({ select: { id: true }, orderBy: { reference: 'asc' } }),
    );
    expect(ids.map((r) => r.id).sort()).toEqual([ok.id, okB.id].sort());
  });

  it('hides every listing of a suspended agency and of a suspended agent', async () => {
    await listing(a, 'A-1');
    await listing(b, 'B-1');
    await owner.agency.update({ where: { id: a.agencyId }, data: { status: 'suspended' } });
    await owner.membership.update({ where: { id: b.membershipId }, data: { status: 'suspended' } });
    const count = await withPublicPortal(app, (tx) => tx.property.count());
    expect(count).toBe(0);
  });

  it('hides agencies awaiting or refused approval, and agents whose user is suspended', async () => {
    await listing(a, 'A-1');
    const pb = await listing(b, 'B-1');
    await owner.agency.update({ where: { id: a.agencyId }, data: { approvalStatus: 'pending' } });
    expect(await withPublicPortal(app, (tx) => tx.property.count())).toBe(1);
    await owner.agency.update({ where: { id: a.agencyId }, data: { approvalStatus: 'approved' } });
    await owner.user.update({ where: { id: b.ownerUserId }, data: { suspendedAt: new Date() } });
    const ids = await withPublicPortal(app, (tx) => tx.property.findMany({ select: { id: true } }));
    expect(ids).toHaveLength(1);
    expect(ids[0]?.id).not.toBe(pb.id);
  });

  it('exposes nothing else tenant-scoped', async () => {
    await listing(a, 'A-1');
    const [teams, invitations, audit, settings, projects, enquiries] = await withPublicPortal(
      app,
      (tx) =>
        Promise.all([
          tx.team.count(),
          tx.invitation.count(),
          tx.auditLog.count(),
          tx.agencySettings.count(),
          tx.project.count(),
          tx.portalEnquiry.count(),
        ]),
    );
    expect({ teams, invitations, audit, settings, projects, enquiries }).toEqual({
      teams: 0,
      invitations: 0,
      audit: 0,
      settings: 0,
      projects: 0,
      enquiries: 0,
    });
  });

  it('cannot change listings, agencies or memberships', async () => {
    const p = await listing(a, 'A-1');
    const [props, agencies, members] = await withPublicPortal(app, async (tx) => [
      await tx.property.updateMany({ data: { price: 1 } }),
      await tx.agency.updateMany({ data: { name: 'x' } }),
      await tx.membership.updateMany({ data: { brn: 'x' } }),
    ]);
    expect([props.count, agencies.count, members.count]).toEqual([0, 0, 0]);
    const fresh = await owner.property.findUniqueOrThrow({ where: { id: p.id } });
    expect(Number(fresh.price)).toBe(1_500_000);
  });

  it('does not apply without opting in', async () => {
    await listing(a, 'A-1');
    const count = await app.$transaction((tx) => tx.property.count());
    expect(count).toBe(0);
  });
});

describe('public portal enquiries and contact clicks', () => {
  it('files an enquiry under the listing agency and agent, write-only', async () => {
    const p = await listing(a, 'A-1');
    const res = await withPublicPortal(app, (tx) =>
      tx.portalEnquiry.createMany({ data: [enquiry(a, p.id)] }),
    );
    expect(res.count).toBe(1);
    const mine = await withTenant(app, { tenantId: a.agencyId }, (tx) =>
      tx.portalEnquiry.findMany(),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]?.membershipId).toBe(a.membershipId);
    const theirs = await withTenant(app, { tenantId: b.agencyId }, (tx) =>
      tx.portalEnquiry.count(),
    );
    expect(theirs).toBe(0);
  });

  it('refuses an enquiry filed under another agency, another agent, or a hidden listing', async () => {
    const p = await listing(a, 'A-1');
    const draft = await listing(a, 'A-2', { status: 'draft' });
    const attempts = [
      { ...enquiry(a, p.id), tenantId: b.agencyId, membershipId: b.membershipId },
      enquiry(a, p.id, b.membershipId),
      enquiry(a, draft.id),
    ];
    for (const data of attempts) {
      await expect(
        withPublicPortal(app, (tx) => tx.portalEnquiry.createMany({ data: [data] })),
      ).rejects.toThrow();
    }
    expect(await owner.portalEnquiry.count()).toBe(0);
  });

  it('records contact clicks only for public listings', async () => {
    const p = await listing(a, 'A-1');
    const hidden = await listing(a, 'A-2', { permit: 'none' });
    await withPublicPortal(app, (tx) =>
      tx.portalContactEvent.createMany({
        data: [
          { tenantId: a.agencyId, propertyId: p.id, membershipId: a.membershipId, channel: 'call' },
        ],
      }),
    );
    await expect(
      withPublicPortal(app, (tx) =>
        tx.portalContactEvent.createMany({
          data: [
            {
              tenantId: a.agencyId,
              propertyId: hidden.id,
              membershipId: a.membershipId,
              channel: 'whatsapp',
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(await owner.portalContactEvent.count()).toBe(1);
  });

  it('rejects an enquiry without contact consent or with a malformed phone', async () => {
    const p = await listing(a, 'A-1');
    for (const data of [
      { ...enquiry(a, p.id), consentContact: false },
      { ...enquiry(a, p.id), phoneE164: '0501234567' },
    ]) {
      await expect(
        withPublicPortal(app, (tx) => tx.portalEnquiry.createMany({ data: [data] })),
      ).rejects.toThrow();
    }
  });
});

describe('agent photos', () => {
  const photo = (t: SeededTenant) => ({
    membershipId: t.membershipId,
    tenantId: t.agencyId,
    contentType: 'image/png',
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    sha256: 'a'.repeat(64),
  });

  it('are private to the agency, and public only for agents the portal can show', async () => {
    await owner.memberPhoto.create({ data: photo(a) });
    await owner.memberPhoto.create({ data: photo(b) });
    expect(await withTenant(app, { tenantId: a.agencyId }, (tx) => tx.memberPhoto.count())).toBe(1);
    expect(await withPublicPortal(app, (tx) => tx.memberPhoto.count())).toBe(2);

    await owner.agency.update({ where: { id: a.agencyId }, data: { status: 'suspended' } });
    await owner.user.update({ where: { id: b.ownerUserId }, data: { suspendedAt: new Date() } });
    expect(await withPublicPortal(app, (tx) => tx.memberPhoto.count())).toBe(0);
  });

  it('cannot be written by the portal or another agency', async () => {
    await expect(
      withPublicPortal(app, (tx) => tx.memberPhoto.createMany({ data: [photo(a)] })),
    ).rejects.toThrow();
    await expect(
      withTenant(app, { tenantId: b.agencyId }, (tx) =>
        tx.memberPhoto.createMany({ data: [photo(a)] }),
      ),
    ).rejects.toThrow();
    expect(await owner.memberPhoto.count()).toBe(0);
  });
});
