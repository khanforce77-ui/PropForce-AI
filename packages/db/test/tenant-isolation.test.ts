import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  findInvitationByTokenHash,
  MissingTenantContextError,
  withTenant,
  withUser,
  type PrismaClient,
} from '../src';
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

beforeAll(async () => {
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
});

describe('without any context (fail closed)', () => {
  it('sees no tenant rows at all', async () => {
    expect(await app.agency.count()).toBe(0);
    expect(await app.agencySettings.count()).toBe(0);
    expect(await app.team.count()).toBe(0);
    expect(await app.membership.count()).toBe(0);
    expect(await app.invitation.count()).toBe(0);
    expect(await app.auditLog.count()).toBe(0);
  });

  it('cannot insert tenant rows', async () => {
    await expect(
      app.team.create({ data: { tenantId: a.agencyId, name: 'Rogue' } }),
    ).rejects.toThrow();
  });
});

describe('with tenant context', () => {
  it('sees only its own tenant data', async () => {
    const seen = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      agencies: await tx.agency.findMany({ select: { id: true } }),
      settings: await tx.agencySettings.findMany({ select: { tenantId: true } }),
      teams: await tx.team.findMany({ select: { tenantId: true } }),
      memberships: await tx.membership.findMany({ select: { tenantId: true } }),
      invitations: await tx.invitation.findMany({ select: { tenantId: true } }),
      audit: await tx.auditLog.findMany({ select: { tenantId: true } }),
    }));
    expect(seen.agencies).toEqual([{ id: a.agencyId }]);
    for (const rows of [
      seen.settings,
      seen.teams,
      seen.memberships,
      seen.invitations,
      seen.audit,
    ]) {
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenantId === a.agencyId)).toBe(true);
    }
  });

  it('cannot read another tenant’s rows by id', async () => {
    const found = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      agency: await tx.agency.findUnique({ where: { id: b.agencyId } }),
      team: await tx.team.findUnique({ where: { id: b.teamId } }),
      membership: await tx.membership.findUnique({ where: { id: b.membershipId } }),
      invitation: await tx.invitation.findUnique({ where: { id: b.invitationId } }),
      audit: await tx.auditLog.findUnique({ where: { id: b.auditLogId } }),
    }));
    expect(found).toEqual({
      agency: null,
      team: null,
      membership: null,
      invitation: null,
      audit: null,
    });
  });

  it('cannot insert rows into another tenant', async () => {
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.team.create({ data: { tenantId: b.agencyId, name: 'Injected' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot update or delete another tenant’s rows', async () => {
    const result = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      updated: await tx.team.updateMany({ where: { id: b.teamId }, data: { name: 'Hijacked' } }),
      deleted: await tx.membership.deleteMany({ where: { tenantId: b.agencyId } }),
      agency: await tx.agency.updateMany({ where: { id: b.agencyId }, data: { name: 'Hijacked' } }),
    }));
    expect(result.updated.count).toBe(0);
    expect(result.deleted.count).toBe(0);
    expect(result.agency.count).toBe(0);
    const bTeam = await owner.team.findUniqueOrThrow({ where: { id: b.teamId } });
    expect(bTeam.name).toBe('Bravo Team');
  });

  it('cannot move its own row into another tenant', async () => {
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.team.update({ where: { id: a.teamId }, data: { tenantId: b.agencyId } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('treats the audit log as append-only', async () => {
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.auditLog.updateMany({ where: { id: a.auditLogId }, data: { action: 'tampered' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
  });

  it('does not leak context to later queries on pooled connections', async () => {
    await withTenant(app, { tenantId: a.agencyId }, (tx) => tx.team.findMany());
    const after = await Promise.all(Array.from({ length: 8 }, () => app.team.count()));
    expect(after.every((n) => n === 0)).toBe(true);
  });

  it('rejects malformed context values', async () => {
    await expect(withTenant(app, { tenantId: 'not-a-uuid' }, async () => 1)).rejects.toBeInstanceOf(
      MissingTenantContextError,
    );
    await expect(
      withTenant(app, { tenantId: "x' OR 1=1 --" }, async () => 1),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
  });
});

describe('agency creation (registration flow)', () => {
  it('creates an agency, settings and owner membership inside the new tenant context', async () => {
    const user = await owner.user.create({
      data: { email: 'new-owner@example.test', fullName: 'New Owner' },
    });
    const agencyId = randomUUID();
    await withTenant(app, { tenantId: agencyId, userId: user.id }, async (tx) => {
      await tx.agency.create({
        data: {
          id: agencyId,
          name: 'Charlie Homes',
          slug: 'charlie-homes',
          emirate: 'Abu Dhabi',
          settings: { create: {} },
        },
      });
      await tx.membership.create({ data: { tenantId: agencyId, userId: user.id, role: 'owner' } });
    });
    const settings = await owner.agencySettings.findUniqueOrThrow({
      where: { tenantId: agencyId },
    });
    expect(settings.outboundVoiceEnabled).toBe(false);
    expect(settings.listingFreshnessDays).toBe(14);
  });

  it('cannot create an agency whose id differs from the context', async () => {
    await expect(
      withTenant(app, { tenantId: randomUUID() }, (tx) =>
        tx.agency.create({ data: { id: randomUUID(), name: 'X', slug: 'x', emirate: 'Dubai' } }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('user context (before an agency is selected)', () => {
  it('sees the user’s own memberships and agencies across tenants, read-only', async () => {
    // Give Alpha's owner a second membership in Bravo.
    await owner.membership.create({
      data: { tenantId: b.agencyId, userId: a.ownerUserId, role: 'agent' },
    });

    const seen = await withUser(app, { userId: a.ownerUserId }, async (tx) => ({
      memberships: await tx.membership.findMany({ select: { tenantId: true, userId: true } }),
      agencies: await tx.agency.findMany({ select: { id: true }, orderBy: { name: 'asc' } }),
      teams: await tx.team.count(),
      invitations: await tx.invitation.count(),
    }));
    expect(seen.memberships).toHaveLength(2);
    expect(seen.memberships.every((m) => m.userId === a.ownerUserId)).toBe(true);
    expect(seen.agencies.map((x) => x.id)).toEqual([a.agencyId, b.agencyId]);
    expect(seen.teams).toBe(0);
    expect(seen.invitations).toBe(0);

    const renamed = await withUser(app, { userId: a.ownerUserId }, (tx) =>
      tx.agency.updateMany({ where: { id: b.agencyId }, data: { name: 'Hijacked' } }),
    );
    expect(renamed.count).toBe(0);
  });

  it('does not see other users’ memberships', async () => {
    const seen = await withUser(app, { userId: a.ownerUserId }, (tx) =>
      tx.membership.findMany({ where: { tenantId: b.agencyId } }),
    );
    expect(seen).toEqual([]);
  });
});

describe('invitation lookup by token', () => {
  it('finds only the invitation whose token hash matches', async () => {
    const found = await findInvitationByTokenHash(app, b.inviteTokenHash);
    expect(found?.id).toBe(b.invitationId);
    expect(await findInvitationByTokenHash(app, `hash_${'0'.repeat(32)}`)).toBeNull();
    expect(await findInvitationByTokenHash(app, "' OR ''='")).toBeNull();
  });
});
