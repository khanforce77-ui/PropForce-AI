import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client';
import { assertUuid, type TenantContext, type UserContext } from './tenant-context';

export type TransactionClient = Prisma.TransactionClient;

export interface CreateClientOptions {
  /** Connection string for the non-owner application role. Never the migration/owner role. */
  connectionString: string;
  /** Pool size for this process. */
  max?: number;
}

export function createPrismaClient(options: CreateClientOptions): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.max ?? 10,
  });
  return new PrismaClient({ adapter });
}

async function setLocal(tx: TransactionClient, key: string, value: string): Promise<void> {
  // set_config(..., true) is transaction-local, so the value never leaks to other requests that
  // later reuse the pooled connection.
  await tx.$executeRaw`SELECT set_config(${key}, ${value}, true)`;
}

/**
 * Runs `fn` in a transaction where row-level security sees `ctx.tenantId`.
 * All tenant-scoped reads and writes must go through this (or `withUser` for the few
 * cross-agency lookups a signed-in user is allowed).
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  ctx: TenantContext,
  fn: (tx: TransactionClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const tenantId = assertUuid(ctx.tenantId, 'tenantId');
  const userId = ctx.userId === undefined ? undefined : assertUuid(ctx.userId, 'userId');
  return prisma.$transaction(
    async (tx) => {
      await setLocal(tx, 'app.tenant_id', tenantId);
      if (userId) await setLocal(tx, 'app.user_id', userId);
      return fn(tx);
    },
    { timeout: options?.timeoutMs ?? 10_000 },
  );
}

/**
 * Runs `fn` with only a user identity. RLS then exposes the user's own memberships and the
 * agencies they belong to (read-only), and nothing else that is tenant-scoped.
 */
export async function withUser<T>(
  prisma: PrismaClient,
  ctx: UserContext,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const userId = assertUuid(ctx.userId, 'userId');
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.user_id', userId);
    return fn(tx);
  });
}

/**
 * Runs `fn` as a platform administrator: read-only visibility of every agency, membership and
 * listing. The database grants it only if the user's is_platform_admin flag is true, so a caller
 * cannot gain it by passing any user id. Writes still need a tenant context.
 */
export async function withPlatformAdmin<T>(
  prisma: PrismaClient,
  ctx: UserContext,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  const userId = assertUuid(ctx.userId, 'userId');
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.user_id', userId);
    await setLocal(tx, 'app.platform_admin', 'on');
    return fn(tx);
  });
}

/**
 * Looks up an invitation by token hash before the accepting user has a tenant context.
 * Only the row whose hash matches is visible.
 */
export async function findInvitationByTokenHash(prisma: PrismaClient, tokenHash: string) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(tokenHash)) return null;
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.invite_token_hash', tokenHash);
    return tx.invitation.findUnique({ where: { tokenHash } });
  });
}

/**
 * Routes a WhatsApp webhook to its agency before any tenant context exists. Only the account row
 * whose phone_number_id matches is visible, and only its routing fields are returned (never the
 * encrypted token). Returns null for unknown or disconnected numbers.
 */
export async function findWhatsAppAccountForWebhook(prisma: PrismaClient, phoneNumberId: string) {
  if (!/^\d{1,32}$/.test(phoneNumberId)) return null;
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.wa_phone_number_id', phoneNumberId);
    return tx.whatsAppAccount.findFirst({
      where: { phoneNumberId, status: 'active' },
      select: { id: true, tenantId: true, wabaId: true, connectedBy: true },
    });
  });
}

/**
 * Looks up the active voice line for a provider phone-number id before the agency is known (voice
 * webhooks). Only the row for that id is visible. Returns null for unknown or switched-off lines.
 */
export async function findVoiceLineForWebhook(prisma: PrismaClient, providerPhoneNumberId: string) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(providerPhoneNumberId)) return null;
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.voice_phone_number_id', providerPhoneNumberId);
    return tx.voiceLine.findFirst({
      where: { providerPhoneNumberId, active: true },
      select: { id: true, tenantId: true, transcriptPolicy: true, createdBy: true },
    });
  });
}

/**
 * Runs `fn` as the anonymous public portal: read-only visibility of published listings (active,
 * fresh, permitted, assigned to an active agent of an active agency) across all agencies, and the
 * right to add enquiries and contact clicks for those listings. Nothing else tenant-scoped is
 * visible. Callers must still pick only public columns.
 */
export async function withPublicPortal<T>(
  prisma: PrismaClient,
  fn: (tx: TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.public_portal', 'on');
    return fn(tx);
  });
}

/**
 * Lists the active developer agencies for the daily payment-reminder run, before any tenant
 * context exists. Only agency ids are returned; each agency is then run in its own tenant context.
 */
export async function listPaymentReminderTenants(prisma: PrismaClient): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await setLocal(tx, 'app.reminder_cron', 'on');
    const rows = await tx.agency.findMany({
      where: { kind: 'developer', status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  });
}
