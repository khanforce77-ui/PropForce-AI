import { Inject, Injectable } from '@nestjs/common';
import { withTenant, type PrismaClient } from '@propforce/db';
import { MediaError, normaliseDocument } from '@propforce/media';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';

/** Largest document accepted in one request (the JSON body carries both, base64-encoded). */
export const MAX_BROKER_DOC_BYTES = 700 * 1024;

export interface BrokerVerificationInput {
  brn: string;
  brnExpiresAt: string;
  card: string;
  emiratesId: string;
}

async function decodeDocument(dataUrl: string, path: string) {
  const match =
    /^data:(?:application\/pdf|image\/(?:jpeg|png|webp|heic|heif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      dataUrl,
    );
  const invalid = (message: string) =>
    new AppError(400, 'VALIDATION_FAILED', message, [{ path, message }]);
  if (!match?.[1]) throw invalid('Upload a PDF or a photo (JPG, PNG, WebP or HEIC).');
  const raw = Buffer.from(match[1], 'base64');
  if (raw.length === 0) throw invalid('The file is empty.');
  if (raw.length > MAX_BROKER_DOC_BYTES) {
    throw invalid('The file is too large (max 700 KB). Upload a photo of the card instead.');
  }
  try {
    return await normaliseDocument(raw);
  } catch (err) {
    if (err instanceof MediaError) throw invalid(err.message);
    throw err;
  }
}

/**
 * An agent asks for the "Verified agent" badge by sending their DLD broker card (with the BRN and
 * its expiry date) and Emirates ID. PropForce checks them; see TrustService.decideBroker.
 */
@Injectable()
export class BrokerVerificationService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: Parameters<typeof withTenant<T>>[2]) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private assertMayEdit(ctx: TenantRequestContext, membershipId: string) {
    if (membershipId !== ctx.membershipId && !hasPermission(ctx.role, 'property:manage')) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You can only send your own documents.');
    }
  }

  get(ctx: TenantRequestContext, membershipId: string) {
    return this.run(ctx, async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId },
        select: { brn: true, brokerVerifiedAt: true, brokerVerifiedUntil: true },
      });
      if (!member) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
      const request = await tx.brokerVerification.findFirst({
        where: { membershipId, tenantId: ctx.tenantId },
        select: {
          brn: true,
          brnExpiresAt: true,
          status: true,
          reason: true,
          submittedAt: true,
          reviewedAt: true,
        },
      });
      const today = new Date(new Date().toISOString().slice(0, 10));
      return {
        verified: !!member.brokerVerifiedUntil && member.brokerVerifiedUntil >= today,
        verifiedUntil: member.brokerVerifiedUntil,
        brn: member.brn,
        request,
      };
    });
  }

  async submit(ctx: TenantRequestContext, membershipId: string, input: BrokerVerificationInput) {
    this.assertMayEdit(ctx, membershipId);
    const expires = new Date(input.brnExpiresAt);
    if (expires < new Date(new Date().toISOString().slice(0, 10))) {
      throw new AppError(400, 'VALIDATION_FAILED', 'This broker card has expired.', [
        { path: 'brnExpiresAt', message: 'Must be today or later' },
      ]);
    }
    const [card, emiratesId] = await Promise.all([
      decodeDocument(input.card, 'card'),
      decodeDocument(input.emiratesId, 'emiratesId'),
    ]);
    return this.run(ctx, async (tx) => {
      const member = await tx.membership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId, status: 'active' },
        select: { id: true },
      });
      if (!member) throw new AppError(404, 'NOT_FOUND', 'Member not found.');
      const data = {
        brn: input.brn,
        brnExpiresAt: expires,
        status: 'pending' as const,
        reason: null,
        cardContentType: card.contentType,
        cardBytes: new Uint8Array(card.bytes),
        emiratesIdContentType: emiratesId.contentType,
        emiratesIdBytes: new Uint8Array(emiratesId.bytes),
        submittedBy: ctx.userId,
        submittedAt: new Date(),
        reviewedAt: null,
        reviewedBy: null,
      };
      const saved = await tx.brokerVerification.upsert({
        where: { membershipId_tenantId: { membershipId, tenantId: ctx.tenantId } },
        create: { ...data, membershipId, tenantId: ctx.tenantId },
        update: data,
        select: { brn: true, brnExpiresAt: true, status: true, submittedAt: true },
      });
      await audit(tx, ctx, {
        action: 'member.broker_verification_requested',
        entityType: 'membership',
        entityId: membershipId,
        after: { brn: input.brn },
      });
      return saved;
    });
  }
}
