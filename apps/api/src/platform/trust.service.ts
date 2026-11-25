import { Inject, Injectable } from '@nestjs/common';
import {
  withPlatformAdmin,
  withTenant,
  type ListingReviewStatus,
  type BrokerVerificationStatus,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { listingChecks } from '../inventory/listing-trust';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const conflict = (message: string) => new AppError(409, 'INVALID_STATUS_CHANGE', message);

export type ListingDecision = 'approve' | 'reject' | 'send_back';
export type BrokerDecision = 'approve' | 'reject';

/**
 * PropForce's trust checks, for platform admins: the listing review queue (listings wait here
 * before they reach the public portal) and agents' broker-card checks for the "Verified agent"
 * badge. Reads go through the cross-agency platform-admin view; each decision is written inside the
 * agency's own tenant context and logged to the agency's and the platform's audit logs.
 */
@Injectable()
export class TrustService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private asPlatform<T>(
    adminUserId: string,
    tenantId: string,
    fn: (tx: TransactionClient, ctx: TenantRequestContext) => Promise<T>,
  ) {
    const ctx: TenantRequestContext = {
      tenantId,
      userId: adminUserId,
      membershipId: null,
      role: 'admin',
      platform: true,
    };
    return withTenant(this.prisma, { tenantId, userId: adminUserId }, (tx) => fn(tx, ctx));
  }

  // ───── listing review ─────

  listingReviews(adminUserId: string, status: ListingReviewStatus) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const rows = await tx.property.findMany({
        where: { reviewStatus: status, deletedAt: null },
        orderBy:
          status === 'pending'
            ? [{ submittedForReviewAt: 'asc' }, { id: 'asc' }]
            : [{ reviewedAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true,
          tenantId: true,
          reference: true,
          title: true,
          listingType: true,
          propertyType: true,
          status: true,
          emirate: true,
          community: true,
          building: true,
          bedrooms: true,
          bathrooms: true,
          areaSqft: true,
          price: true,
          rentPeriod: true,
          description: true,
          reviewStatus: true,
          reviewReason: true,
          submittedForReviewAt: true,
          reviewedAt: true,
          createdAt: true,
          agency: { select: { id: true, name: true, orn: true } },
          assigned: {
            select: {
              id: true,
              brn: true,
              brokerVerifiedUntil: true,
              user: { select: { fullName: true } },
            },
          },
          permits: {
            orderBy: { validUntil: 'desc' },
            select: {
              id: true,
              authority: true,
              purpose: true,
              permitNumber: true,
              validUntil: true,
              verificationUrl: true,
              document: { select: { fileName: true } },
            },
          },
          _count: { select: { photos: true, reports: { where: { status: 'open' } } } },
        },
      });
      return rows.map(({ _count, ...p }) => ({
        ...p,
        photoCount: _count.photos,
        openReports: _count.reports,
        checks: listingChecks({
          ...p,
          photoCount: _count.photos,
          permits: p.permits.map((x) => ({ ...x, hasDocument: !!x.document })),
          agentVerifiedUntil: p.assigned?.brokerVerifiedUntil ?? null,
        }),
      }));
    });
  }

  async decideListing(
    adminUserId: string,
    propertyId: string,
    decision: ListingDecision,
    reason: string | undefined,
  ) {
    if (decision !== 'approve' && !reason) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Give the agency a reason.', [
        { path: 'reason', message: 'Required' },
      ]);
    }
    const tenantId = await this.tenantOfListing(adminUserId, propertyId);
    return this.asPlatform(adminUserId, tenantId, async (tx, ctx) => {
      const p = await tx.property.findFirst({ where: { id: propertyId, deletedAt: null } });
      if (!p) throw notFound('Listing');
      const now = new Date();
      let data;
      if (decision === 'approve') {
        if (p.reviewStatus !== 'pending') throw conflict('This listing is not waiting for review.');
        data = { reviewStatus: 'approved' as const, reviewReason: null };
      } else if (decision === 'reject') {
        if (p.reviewStatus !== 'pending') throw conflict('This listing is not waiting for review.');
        // Back to draft: the agency fixes it and publishes again, which asks for a new review.
        data = {
          reviewStatus: 'rejected' as const,
          reviewReason: reason ?? null,
          ...(p.status === 'active' || p.status === 'under_offer'
            ? { status: 'draft' as const }
            : {}),
        };
      } else {
        if (p.reviewStatus === 'pending') throw conflict('This listing is already in review.');
        // Takes a live listing off the portal (e.g. after a report) until it is checked again.
        data = {
          reviewStatus: 'pending' as const,
          reviewReason: reason ?? null,
          submittedForReviewAt: now,
        };
      }
      const updated = await tx.property.update({
        where: { id: p.id },
        data: { ...data, reviewedAt: now, reviewedBy: adminUserId },
        select: { id: true, status: true, reviewStatus: true, reviewReason: true },
      });
      await audit(tx, ctx, {
        action: `property.review_${decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'reopened'}`,
        entityType: 'property',
        entityId: p.id,
        before: { status: p.status, reviewStatus: p.reviewStatus },
        after: {
          reference: p.reference,
          status: updated.status,
          reviewStatus: updated.reviewStatus,
          reason: updated.reviewReason,
        },
      });
      return updated;
    });
  }

  async permitDocument(adminUserId: string, propertyId: string, permitId: string) {
    const doc = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.propertyPermitDocument.findFirst({
        where: { permitId, permit: { propertyId } },
        select: { contentType: true, fileName: true, bytes: true },
      }),
    );
    if (!doc) throw notFound('Permit document');
    return doc;
  }

  private async tenantOfListing(adminUserId: string, propertyId: string) {
    const row = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.property.findFirst({
        where: { id: propertyId, deletedAt: null },
        select: { tenantId: true },
      }),
    );
    if (!row) throw notFound('Listing');
    return row.tenantId;
  }

  // ───── broker verification ─────

  brokerVerifications(adminUserId: string, status: BrokerVerificationStatus) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.brokerVerification.findMany({
        where: { status },
        orderBy:
          status === 'pending'
            ? [{ submittedAt: 'asc' }, { id: 'asc' }]
            : [{ reviewedAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true,
          brn: true,
          brnExpiresAt: true,
          status: true,
          reason: true,
          submittedAt: true,
          reviewedAt: true,
          cardContentType: true,
          emiratesIdContentType: true,
          agency: { select: { id: true, name: true, orn: true } },
          membership: {
            select: { id: true, role: true, user: { select: { fullName: true, email: true } } },
          },
        },
      }),
    );
  }

  async brokerDocument(adminUserId: string, id: string, which: 'card' | 'emirates_id') {
    const row = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.brokerVerification.findUnique({
        where: { id },
        select: {
          cardContentType: true,
          cardBytes: true,
          emiratesIdContentType: true,
          emiratesIdBytes: true,
        },
      }),
    );
    if (!row) throw notFound('Verification');
    if (which === 'card') return { contentType: row.cardContentType, bytes: row.cardBytes };
    if (!row.emiratesIdBytes || !row.emiratesIdContentType) {
      throw notFound('Emirates ID copy (deleted after the decision)');
    }
    return { contentType: row.emiratesIdContentType, bytes: row.emiratesIdBytes };
  }

  async decideBroker(
    adminUserId: string,
    id: string,
    decision: BrokerDecision,
    reason: string | undefined,
  ) {
    if (decision === 'reject' && !reason) {
      throw new AppError(400, 'VALIDATION_FAILED', 'Give the agent a reason.', [
        { path: 'reason', message: 'Required' },
      ]);
    }
    const found = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.brokerVerification.findUnique({ where: { id }, select: { tenantId: true } }),
    );
    if (!found) throw notFound('Verification');
    return this.asPlatform(adminUserId, found.tenantId, async (tx, ctx) => {
      const v = await tx.brokerVerification.findUnique({ where: { id } });
      if (!v) throw notFound('Verification');
      if (v.status !== 'pending') throw conflict('This request was already decided.');
      const now = new Date();
      if (decision === 'approve' && v.brnExpiresAt < new Date(now.toISOString().slice(0, 10))) {
        throw conflict('The broker card has expired. Reject it and ask for the renewed card.');
      }
      // The Emirates ID copy is only needed to decide; it is deleted either way.
      const updated = await tx.brokerVerification.update({
        where: { id },
        data: {
          status: decision === 'approve' ? 'approved' : 'rejected',
          reason: decision === 'reject' ? (reason ?? null) : null,
          reviewedAt: now,
          reviewedBy: adminUserId,
          emiratesIdBytes: null,
          emiratesIdContentType: null,
        },
        select: { id: true, status: true, reason: true, membershipId: true },
      });
      if (decision === 'approve') {
        await tx.membership.update({
          where: { id: v.membershipId },
          data: { brn: v.brn, brokerVerifiedAt: now, brokerVerifiedUntil: v.brnExpiresAt },
        });
      }
      await audit(tx, ctx, {
        action: decision === 'approve' ? 'member.broker_verified' : 'member.broker_rejected',
        entityType: 'membership',
        entityId: v.membershipId,
        after: { brn: v.brn, reason: updated.reason },
      });
      return updated;
    });
  }
}
