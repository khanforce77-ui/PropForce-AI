import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  withPlatformAdmin,
  withTenant,
  type AgencyStatus,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { randomUUID } from 'node:crypto';
import { generateToken, hashToken } from '../auth/crypto';
import { slugify } from '../auth/auth.service';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';
import { EmailSender } from '../email/email.sender';
import { assertKycApproved } from '../kyc/kyc-rules';
import type { AgencyCreate } from './site-content.schemas';
import { renderEmail } from '../email/templates';

export interface AgencyPlanInput {
  plan?: string | undefined;
  seatLimit?: number | null | undefined;
  listingLimit?: number | null | undefined;
}

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const conflict = (message: string) => new AppError(409, 'INVALID_STATUS_CHANGE', message);

const DAY_MS = 86_400_000;
const INVITE_TTL_MS = 7 * DAY_MS;

export interface AgencyDetailsInput {
  name?: string | undefined;
  emirate?: string | undefined;
  orn?: string | null | undefined;
  tradeLicenseNo?: string | null | undefined;
}

/** Read-only, cross-agency figures for platform administrators. */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly email: EmailSender,
  ) {}

  summary(adminUserId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const weekAgo = new Date(Date.now() - 7 * DAY_MS);
      const [agenciesByStatus, users, newUsers, newAgencies, listingsByStatus, verifiedUsers] =
        await Promise.all([
          tx.agency.groupBy({ by: ['status'], _count: { _all: true } }),
          tx.user.count(),
          tx.user.count({ where: { createdAt: { gte: weekAgo } } }),
          tx.agency.count({ where: { createdAt: { gte: weekAgo } } }),
          tx.property.groupBy({
            by: ['status'],
            where: { deletedAt: null },
            _count: { _all: true },
          }),
          tx.user.count({ where: { emailVerifiedAt: { not: null } } }),
        ]);
      const agencies = Object.fromEntries(agenciesByStatus.map((r) => [r.status, r._count._all]));
      const listings = Object.fromEntries(listingsByStatus.map((r) => [r.status, r._count._all]));
      const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
      return {
        agencies: {
          total: sum(agencies),
          active: agencies.active ?? 0,
          pending: agencies.pending ?? 0,
          suspended: agencies.suspended ?? 0,
          newThisWeek: newAgencies,
        },
        users: { total: users, verified: verifiedUsers, newThisWeek: newUsers },
        listings: { total: sum(listings), live: listings.active ?? 0, draft: listings.draft ?? 0 },
      };
    });
  }

  agencies(adminUserId: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const rows = await tx.agency.findMany({
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: {
          id: true,
          name: true,
          emirate: true,
          status: true,
          orn: true,
          tradeLicenseNo: true,
          createdAt: true,
          onboardedAt: true,
          approvalStatus: true,
          statusReason: true,
          plan: true,
          seatLimit: true,
          listingLimit: true,
          isPlatformOwned: true,
          kind: true,
          memberships: {
            where: { status: 'active' },
            select: { role: true, user: { select: { fullName: true, email: true } } },
          },
          _count: {
            select: {
              properties: { where: { deletedAt: null } },
              leads: true,
            },
          },
        },
      });
      return rows.map(({ memberships, _count, ...a }) => {
        const owner = memberships.find((m) => m.role === 'owner')?.user ?? null;
        return {
          ...a,
          owner,
          members: memberships.length,
          listings: _count.properties,
          leads: _count.leads,
        };
      });
    });
  }

  recentUsers(adminUserId: string, q?: string) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      const users = await tx.user.findMany({
        where: q
          ? {
              OR: [
                { email: { contains: q, mode: 'insensitive' } },
                { fullName: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          isPlatformAdmin: true,
          suspendedAt: true,
          suspendedReason: true,
          id: true,
          fullName: true,
          email: true,
          createdAt: true,
          emailVerifiedAt: true,
          lastLoginAt: true,
          memberships: {
            select: { role: true, agency: { select: { id: true, name: true } } },
          },
        },
      });
      return users;
    });
  }

  /**
   * Daily trends (UAE days) for the last `days` days, headline counts and the most active
   * agencies, for the platform dashboard. Read-only, through the platform-admin read policies.
   */
  dashboard(adminUserId: string, days: number) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, async (tx) => {
      // Days are UAE calendar days (UTC+4, no daylight saving).
      const UAE = 4 * 3_600_000;
      const firstDay = (Math.floor((Date.now() + UAE) / DAY_MS) - (days - 1)) * DAY_MS;
      const since = new Date(firstDay - UAE);
      const daily = (table: 'agency' | 'user' | 'property' | 'lead' | 'portal_enquiry') =>
        tx.$queryRawUnsafe<{ d: string; n: bigint }[]>(
          `SELECT to_char(created_at AT TIME ZONE 'Asia/Dubai', 'YYYY-MM-DD') AS d, count(*) AS n
             FROM "${table}" WHERE created_at >= $1 GROUP BY 1`,
          since,
        );
      const [agencies, users, listings, leads, enquiries] = await Promise.all([
        daily('agency'),
        daily('user'),
        daily('property'),
        daily('lead'),
        daily('portal_enquiry'),
      ]);
      const dates: string[] = [];
      for (let i = 0; i < days; i++) {
        dates.push(new Date(firstDay + i * DAY_MS).toISOString().slice(0, 10));
      }
      const series = (rows: { d: string; n: bigint }[]) => {
        const byDay = new Map(rows.map((r) => [r.d, Number(r.n)]));
        return dates.map((d) => byDay.get(d) ?? 0);
      };

      const [leadsTotal, leadsOpen, enquiriesTotal, enquiriesNew, top] = await Promise.all([
        tx.lead.count(),
        tx.lead.count({ where: { stage: { notIn: ['won', 'lost'] } } }),
        tx.portalEnquiry.count(),
        tx.portalEnquiry.count({ where: { status: 'new' } }),
        tx.agency.findMany({
          where: { status: { not: 'cancelled' } },
          select: {
            id: true,
            name: true,
            isPlatformOwned: true,
            _count: {
              select: {
                properties: { where: { deletedAt: null } },
                leads: true,
                memberships: { where: { status: 'active' } },
              },
            },
          },
          take: 200,
        }),
      ]);
      const topAgencies = top
        .map((a) => ({
          id: a.id,
          name: a.name,
          isPlatformOwned: a.isPlatformOwned,
          listings: a._count.properties,
          leads: a._count.leads,
          members: a._count.memberships,
        }))
        .sort((x, y) => y.listings + y.leads - (x.listings + x.leads))
        .slice(0, 5);

      return {
        dates,
        series: {
          agencies: series(agencies),
          users: series(users),
          listings: series(listings),
          leads: series(leads),
          enquiries: series(enquiries),
        },
        totals: {
          leads: leadsTotal,
          openLeads: leadsOpen,
          enquiries: enquiriesTotal,
          newEnquiries: enquiriesNew,
        },
        topAgencies,
      };
    });
  }

  /** Listings across all agencies, newest first, for the admin "All listings" view. */
  /** Every visitor report about a public listing, across agencies (read-only for admins). */
  listingReports(adminUserId: string, status?: 'open' | 'resolved' | 'dismissed') {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.portalListingReport.findMany({
        where: status ? { status } : {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true,
          reason: true,
          details: true,
          email: true,
          status: true,
          createdAt: true,
          agency: { select: { id: true, name: true } },
          property: {
            select: { id: true, reference: true, title: true, community: true, status: true },
          },
        },
      }),
    );
  }

  listings(adminUserId: string, q: { q?: string | undefined; status?: string | undefined }) {
    return withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.property.findMany({
        where: {
          deletedAt: null,
          ...(q.status ? { status: q.status as Prisma.EnumPropertyStatusFilter['equals'] } : {}),
          ...(q.q
            ? {
                OR: [
                  { reference: { contains: q.q, mode: 'insensitive' } },
                  { title: { contains: q.q, mode: 'insensitive' } },
                  { community: { contains: q.q, mode: 'insensitive' } },
                  { building: { contains: q.q, mode: 'insensitive' } },
                  { agency: { name: { contains: q.q, mode: 'insensitive' } } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: {
          id: true,
          reference: true,
          title: true,
          listingType: true,
          propertyType: true,
          status: true,
          emirate: true,
          community: true,
          building: true,
          bedrooms: true,
          price: true,
          rentPeriod: true,
          createdAt: true,
          agency: { select: { id: true, name: true, isPlatformOwned: true } },
          assigned: { select: { user: { select: { fullName: true } } } },
        },
      }),
    );
  }

  /**
   * The platform's own agency, "PropForce Direct", where platform admins list properties
   * themselves. Created on first use; the calling admin becomes an owner member so listings can
   * be assigned to them and shown on the portal under their name.
   */
  async direct(adminUserId: string) {
    const existing = await withPlatformAdmin(this.prisma, { userId: adminUserId }, (tx) =>
      tx.agency.findFirst({ where: { isPlatformOwned: true }, select: { id: true } }),
    );
    const agencyId = existing?.id ?? randomUUID();
    await withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, async (tx) => {
      if (!existing) {
        await tx.agency.create({
          data: {
            id: agencyId,
            name: 'PropForce Direct',
            slug: `propforce-direct-${agencyId.slice(0, 6)}`,
            emirate: 'Dubai',
            status: 'active',
            onboardedAt: new Date(),
            approvalStatus: 'not_required',
            plan: 'platform',
            isPlatformOwned: true,
            settings: { create: {} },
          },
        });
        await this.platformAudit(
          tx,
          adminUserId,
          'platform.direct_agency_created',
          'agency',
          agencyId,
          {},
          'PropForce Direct',
        );
      }
      const membership = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId: agencyId, userId: adminUserId } },
      });
      if (!membership) {
        await tx.membership.create({
          data: { tenantId: agencyId, userId: adminUserId, role: 'owner' },
        });
      } else if (membership.status !== 'active' || membership.role !== 'owner') {
        await tx.membership.update({
          where: { id: membership.id },
          data: { status: 'active', role: 'owner' },
        });
      }
    });
    return { agencyId };
  }

  // ───── agencies created by the platform ─────

  private assertEmirate(emirate: string) {
    if (
      !this.config.supportedEmirates.includes(emirate as AppConfig['supportedEmirates'][number])
    ) {
      throw new AppError(400, 'VALIDATION_FAILED', 'This emirate is not supported yet.', [
        { path: 'emirate', message: `Supported: ${this.config.supportedEmirates.join(', ')}` },
      ]);
    }
  }

  /**
   * Creates an agency on someone's behalf. It is live straight away (a platform admin made it,
   * so no approval is needed). With an owner email, that person gets an invitation to own it.
   */
  async createAgency(adminUserId: string, input: AgencyCreate) {
    this.assertEmirate(input.emirate);
    const agencyId = randomUUID();
    await withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, async (tx) => {
      await tx.agency.create({
        data: {
          id: agencyId,
          name: input.name,
          slug: slugify(input.name),
          emirate: input.emirate,
          orn: input.orn || null,
          tradeLicenseNo: input.tradeLicenseNo || null,
          status: 'active',
          onboardedAt: new Date(),
          approvalStatus: 'not_required',
          plan: input.plan ?? 'trial',
          seatLimit: input.seatLimit ?? null,
          listingLimit: input.listingLimit ?? null,
          settings: { create: {} },
        },
      });
      await tx.auditLog.create({
        data: {
          tenantId: agencyId,
          actorType: 'platform',
          actorUserId: adminUserId,
          action: 'agency.created_by_platform',
          entityType: 'agency',
          entityId: agencyId,
          after: { name: input.name, emirate: input.emirate },
        },
      });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.agency_created',
        'agency',
        agencyId,
        { after: { emirate: input.emirate, plan: input.plan ?? 'trial' } },
        input.name,
      );
    });
    const invitation = input.ownerEmail
      ? await this.inviteToAgency(adminUserId, agencyId, input.ownerEmail, 'owner')
      : null;
    return { agencyId, invitation };
  }

  /**
   * Invites someone into any agency as owner or admin, by email. The invitation link works like
   * one an agency sends itself (7 days, the invited email must accept).
   */
  async inviteToAgency(
    adminUserId: string,
    agencyId: string,
    email: string,
    role: 'owner' | 'admin',
  ) {
    const token = generateToken();
    const { invitation, agencyName } = await withTenant(
      this.prisma,
      { tenantId: agencyId, userId: adminUserId },
      async (tx) => {
        const agency = await tx.agency.findUnique({ where: { id: agencyId } });
        if (!agency) throw notFound('Agency');
        const existingMember = await tx.membership.findFirst({
          where: { tenantId: agencyId, status: { not: 'removed' }, user: { email } },
        });
        if (existingMember) {
          throw new AppError(
            409,
            'CONFLICT_DUPLICATE',
            'This person is already a member of the agency.',
          );
        }
        await tx.invitation.updateMany({
          where: { tenantId: agencyId, email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const invitation = await tx.invitation.create({
          data: {
            tenantId: agencyId,
            email,
            role,
            tokenHash: hashToken(token),
            invitedBy: adminUserId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
          select: { id: true, email: true, role: true, expiresAt: true },
        });
        await tx.auditLog.create({
          data: {
            tenantId: agencyId,
            actorType: 'platform',
            actorUserId: adminUserId,
            action: 'member.invited',
            entityType: 'invitation',
            entityId: invitation.id,
            after: { email, role },
          },
        });
        await this.platformAudit(
          tx,
          adminUserId,
          'platform.agency_invitation_sent',
          'agency',
          agencyId,
          { after: { email, role } },
          agency.name,
        );
        return { invitation, agencyName: agency.name };
      },
    );
    // Platform admins also get the link itself, so they can share it on WhatsApp when email
    // cannot be delivered (e.g. while the email service is limited to verified addresses).
    const inviteUrl = `${this.config.webUrl}/accept-invite?token=${token}`;
    let emailed = true;
    try {
      await this.email.send({
        to: email,
        subject: `You're invited to ${role === 'owner' ? 'own' : 'manage'} ${agencyName} on PropForce`,
        ...renderEmail(
          {
            preheader: `Your agency ${agencyName} is ready on PropForce.`,
            heading: `Welcome to PropForce`,
            paragraphs: [
              `PropForce has set up ${agencyName} for you as ${role}.`,
              'Accept the invitation to set your password, add your team and publish listings on propforce.io.',
            ],
            button: { label: 'Accept invitation', url: inviteUrl },
            footnote: 'This invitation expires in 7 days and works once.',
          },
          this.config.webUrl,
        ),
      });
    } catch (err) {
      emailed = false;
      this.logger.error(`Invitation email failed: ${(err as Error).message}`);
    }
    return { ...invitation, emailed, inviteUrl };
  }

  updateAgencyDetails(adminUserId: string, agencyId: string, input: AgencyDetailsInput) {
    if (input.emirate !== undefined) this.assertEmirate(input.emirate);
    const data = Object.fromEntries(
      Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, v === '' ? null : v]),
    ) as Prisma.AgencyUpdateInput;
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_details_changed', () => data);
  }

  // ───── agency controls ─────

  async approveAgency(adminUserId: string, agencyId: string) {
    // Registration documents (when required) must all be approved before the agency goes live.
    await withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, (tx) =>
      assertKycApproved(tx, agencyId),
    );
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_approved', (a) => {
      if (a.approvalStatus !== 'pending')
        throw conflict('This agency is not waiting for approval.');
      return {
        approvalStatus: 'approved',
        status: 'active',
        statusReason: null,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      };
    });
  }

  rejectAgency(adminUserId: string, agencyId: string, reason: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_rejected', (a) => {
      if (a.approvalStatus !== 'pending')
        throw conflict('This agency is not waiting for approval.');
      return {
        approvalStatus: 'rejected',
        status: 'cancelled',
        statusReason: reason,
        reviewedAt: new Date(),
        reviewedBy: adminUserId,
      };
    });
  }

  suspendAgency(adminUserId: string, agencyId: string, reason: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_suspended', (a) => {
      if (a.status === 'suspended') throw conflict('This agency is already suspended.');
      if (a.status === 'cancelled') throw conflict('This agency is closed.');
      return { status: 'suspended', statusReason: reason };
    });
  }

  reactivateAgency(adminUserId: string, agencyId: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_reactivated', (a) => {
      if (a.status !== 'suspended') throw conflict('Only a suspended agency can be reactivated.');
      const status: AgencyStatus =
        a.onboardedAt && a.approvalStatus !== 'pending' ? 'active' : 'pending';
      return { status, statusReason: null };
    });
  }

  /** Counts the current tenant's business data (call inside withTenant). */
  private async businessData(tx: TransactionClient) {
    const [listings, contacts, leads, deals, conversations, enquiries] = await Promise.all([
      tx.property.count(),
      tx.contact.count(),
      tx.lead.count(),
      tx.deal.count(),
      tx.conversation.count(),
      tx.portalEnquiry.count(),
    ]);
    const counts = { listings, contacts, leads, deals, conversations, enquiries };
    return { ...counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  /** What "Delete agency" would do, so the confirmation can say so. */
  deletePreview(adminUserId: string, agencyId: string) {
    return withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, async (tx) => {
      const agency = await tx.agency.findUnique({ where: { id: agencyId }, select: { id: true } });
      if (!agency) throw notFound('Agency');
      const data = await this.businessData(tx);
      return { mode: data.total > 0 ? ('archive' as const) : ('delete' as const), ...data };
    });
  }

  /**
   * "Delete agency". An agency with no business data (listings, contacts, leads, deals,
   * conversations or enquiries) is removed for good, with its memberships and invitations. Any
   * other agency is archived instead: it is closed, members lose access, its listings leave the
   * website, pending invitations are revoked, and nothing is erased, so it can be restored.
   */
  async deleteAgency(
    adminUserId: string,
    agencyId: string,
  ): Promise<{ result: 'deleted' | 'archived'; name: string }> {
    return withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, async (tx) => {
      const agency = await tx.agency.findUnique({
        where: { id: agencyId },
        select: { id: true, name: true, status: true, isPlatformOwned: true },
      });
      if (!agency) throw notFound('Agency');
      if (agency.isPlatformOwned) {
        throw new AppError(403, 'PERMISSION_DENIED', "PropForce's own agency cannot be deleted.");
      }
      const hasData = (await this.businessData(tx)).total > 0;

      if (!hasData) {
        await tx.agency.delete({ where: { id: agencyId } });
        await this.platformAudit(
          tx,
          adminUserId,
          'platform.agency_deleted',
          'agency',
          agencyId,
          { before: { name: agency.name, status: agency.status }, after: { deleted: true } },
          agency.name,
        );
        return { result: 'deleted', name: agency.name };
      }

      if (agency.status === 'cancelled') throw conflict('This agency is already archived.');
      const data = { status: 'cancelled' as const, statusReason: 'Archived by PropForce.' };
      await tx.agency.update({ where: { id: agencyId }, data });
      await tx.invitation.updateMany({
        where: { acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const diff = { before: { status: agency.status }, after: { status: 'cancelled' } };
      await tx.auditLog.create({
        data: {
          tenantId: agencyId,
          actorType: 'platform',
          actorUserId: adminUserId,
          action: 'platform.agency_archived',
          entityType: 'agency',
          entityId: agencyId,
          ...diff,
        },
      });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.agency_archived',
        'agency',
        agencyId,
        diff,
        agency.name,
      );
      return { result: 'archived', name: agency.name };
    });
  }

  /** Brings an archived (or rejected) agency back. */
  restoreAgency(adminUserId: string, agencyId: string) {
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_restored', (a) => {
      if (a.status !== 'cancelled') throw conflict('Only an archived agency can be restored.');
      const approved = a.approvalStatus !== 'pending';
      return {
        status: a.onboardedAt && approved ? 'active' : 'pending',
        statusReason: null,
        ...(a.approvalStatus === 'rejected'
          ? { approvalStatus: 'approved' as const, reviewedAt: new Date(), reviewedBy: adminUserId }
          : {}),
      };
    });
  }

  updateAgencyPlan(adminUserId: string, agencyId: string, input: AgencyPlanInput) {
    const data = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ) as Prisma.AgencyUpdateInput;
    return this.changeAgency(adminUserId, agencyId, 'platform.agency_plan_changed', () => data);
  }

  /**
   * Applies a platform change to one agency inside that agency's tenant context (RLS allows it
   * because the tenant matches), writes the agency's own audit log as the platform, and the
   * platform audit log.
   */
  private async changeAgency(
    adminUserId: string,
    agencyId: string,
    action: string,
    change: (agency: Prisma.AgencyGetPayload<object>) => Prisma.AgencyUpdateInput,
  ) {
    return withTenant(this.prisma, { tenantId: agencyId, userId: adminUserId }, async (tx) => {
      const before = await tx.agency.findUnique({ where: { id: agencyId } });
      if (!before) throw notFound('Agency');
      const data = change(before);
      const after = await tx.agency.update({ where: { id: agencyId }, data });
      const keys = Object.keys(data);
      const diff = {
        before: pickJson(before, keys),
        after: pickJson(after, keys),
      };
      await tx.auditLog.create({
        data: {
          tenantId: agencyId,
          actorType: 'platform',
          actorUserId: adminUserId,
          action,
          entityType: 'agency',
          entityId: agencyId,
          ...diff,
        },
      });
      await this.platformAudit(tx, adminUserId, action, 'agency', agencyId, diff, before.name);
      return after;
    });
  }

  // ───── user controls ─────

  suspendUser(adminUserId: string, userId: string, reason: string) {
    if (adminUserId === userId) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You cannot suspend your own account.');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('User');
      if (user.suspendedAt) throw conflict('This user is already suspended.');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { suspendedAt: new Date(), suspendedReason: reason },
        select: { id: true, email: true, suspendedAt: true, suspendedReason: true },
      });
      // Sign them out everywhere, now.
      const sessions = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.user_suspended',
        'user',
        userId,
        {
          after: { reason, sessionsRevoked: sessions.count },
        },
        user.email,
      );
      return updated;
    });
  }

  reactivateUser(adminUserId: string, userId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw notFound('User');
      if (!user.suspendedAt) throw conflict('This user is not suspended.');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { suspendedAt: null, suspendedReason: null },
        select: { id: true, email: true, suspendedAt: true, suspendedReason: true },
      });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.user_reactivated',
        'user',
        userId,
        {},
        updated.email,
      );
      return updated;
    });
  }

  // ───── settings and flags ─────

  listFlags() {
    return this.prisma.featureFlag.findMany({ orderBy: { key: 'asc' } });
  }

  setFlag(adminUserId: string, key: string, enabled: boolean) {
    return this.prisma.$transaction(async (tx) => {
      const flag = await tx.featureFlag.findUnique({ where: { key } });
      if (!flag) throw notFound('Setting');
      const updated = await tx.featureFlag.update({ where: { key }, data: { enabled } });
      await this.platformAudit(
        tx,
        adminUserId,
        'platform.setting_changed',
        'feature_flag',
        key,
        {
          before: { enabled: flag.enabled },
          after: { enabled },
        },
        key,
      );
      return updated;
    });
  }

  auditLog() {
    return this.prisma.platformAuditLog.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
  }

  /** Writes the platform audit log. Also used by the website content service. */
  async platformAudit(
    tx: TransactionClient,
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string,
    diff: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
    targetLabel: string,
  ) {
    const actor = await tx.user.findUniqueOrThrow({
      where: { id: actorUserId },
      select: { email: true },
    });
    await tx.platformAuditLog.create({
      data: {
        actorUserId,
        action,
        targetType,
        targetId,
        ...(diff.before !== undefined ? { before: diff.before } : {}),
        after: {
          ...((diff.after as object | undefined) ?? {}),
          target: targetLabel,
          by: actor.email,
        },
      },
    });
  }
}

function pickJson(obj: object, keys: string[]): Prisma.InputJsonValue {
  const source = obj as Record<string, unknown>;
  return JSON.parse(
    JSON.stringify(Object.fromEntries(keys.map((k) => [k, source[k] ?? null]))),
  ) as Prisma.InputJsonValue;
}
