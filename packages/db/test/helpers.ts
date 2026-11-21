import { randomUUID } from 'node:crypto';
import { createPrismaClient, type PrismaClient } from '../src';

export const OWNER_URL =
  process.env.MIGRATION_DATABASE_URL ??
  'postgresql://propforce:propforce_dev_only@localhost:5432/propforce';
export const APP_URL =
  process.env.DATABASE_URL ??
  'postgresql://propforce_app_user:propforce_app_dev_only@localhost:5432/propforce';

/** Owner client: bypasses RLS. Used only to arrange and inspect fixtures. */
export const createOwnerClient = (): PrismaClient =>
  createPrismaClient({ connectionString: OWNER_URL, max: 2 });
/** Application client: subject to RLS, exactly like the API and workers. */
export const createAppClient = (): PrismaClient =>
  createPrismaClient({ connectionString: APP_URL, max: 4 });

export async function resetDatabase(owner: PrismaClient): Promise<void> {
  // TRUNCATE ... CASCADE on "agency" also empties "fee_rule", including the migration-seeded
  // shared templates (tenant_id IS NULL) that later suites rely on. Keep and restore them.
  const templates = await owner.$queryRawUnsafe<{ rows: unknown }[]>(
    `SELECT coalesce(json_agg(f), '[]'::json) AS rows FROM "fee_rule" f WHERE tenant_id IS NULL`,
  );
  await owner.$executeRawUnsafe(
    'TRUNCATE "audit_log", "invitation", "membership", "team", "agency_settings", "agency", "mfa_factor", "session", "user" CASCADE',
  );
  await owner.$executeRawUnsafe(
    'INSERT INTO "fee_rule" SELECT * FROM json_populate_recordset(NULL::"fee_rule", $1::json)',
    JSON.stringify(templates[0]?.rows ?? []),
  );
}

export interface SeededTenant {
  agencyId: string;
  ownerUserId: string;
  teamId: string;
  membershipId: string;
  invitationId: string;
  inviteTokenHash: string;
  auditLogId: string;
}

export async function seedTenant(owner: PrismaClient, name: string): Promise<SeededTenant> {
  const agencyId = randomUUID();
  const slug = `${name.toLowerCase()}-${agencyId.slice(0, 8)}`;
  const user = await owner.user.create({
    data: { email: `${slug}@example.test`, fullName: `${name} Owner` },
  });
  await owner.agency.create({
    data: {
      id: agencyId,
      name,
      slug,
      emirate: 'Dubai',
      status: 'active',
      settings: { create: {} },
    },
  });
  const team = await owner.team.create({ data: { tenantId: agencyId, name: `${name} Team` } });
  const membership = await owner.membership.create({
    data: { tenantId: agencyId, userId: user.id, role: 'owner', teamId: team.id },
  });
  const inviteTokenHash = `hash_${randomUUID().replace(/-/g, '')}`;
  const invitation = await owner.invitation.create({
    data: {
      tenantId: agencyId,
      email: `agent@${slug}.test`,
      role: 'agent',
      tokenHash: inviteTokenHash,
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const audit = await owner.auditLog.create({
    data: {
      tenantId: agencyId,
      actorType: 'user',
      actorUserId: user.id,
      action: 'agency.created',
      entityType: 'agency',
      entityId: agencyId,
    },
  });
  return {
    agencyId,
    ownerUserId: user.id,
    teamId: team.id,
    membershipId: membership.id,
    invitationId: invitation.id,
    inviteTokenHash,
    auditLogId: audit.id,
  };
}
