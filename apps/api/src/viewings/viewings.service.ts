import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_SLOT_OPTIONS,
  DUBAI_DEFAULT_HOURS,
  findFreeSlots,
  overlaps,
} from '@propforce/calendar';
import {
  Prisma,
  withTenant,
  type PrismaClient,
  type TransactionClient,
  type ViewingStatus,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import { ownMembershipId, type TenantRequestContext } from '../tenancy/tenant.guard';
import type {
  AvailabilityQuery,
  ListViewingsQuery,
  ViewingCreateInput,
  ViewingStatusInput,
  ViewingUpdateInput,
} from './viewings.schemas';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const MIN = 60_000;
/** Travel time kept free around every viewing. */
export const BUFFER_MINUTES = DEFAULT_SLOT_OPTIONS.bufferMinutes;
/** Statuses that hold time on the agent's calendar. */
const BLOCKING: ViewingStatus[] = ['requested', 'confirmed'];

/** Allowed status changes. Completed/no-show/cancelled are final. */
const NEXT: Record<ViewingStatus, ViewingStatus[]> = {
  requested: ['confirmed', 'cancelled'],
  confirmed: ['completed', 'no_show', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
};

const STATUS_TEXT: Record<ViewingStatus, string> = {
  requested: 'requested',
  confirmed: 'confirmed',
  completed: 'done',
  no_show: 'marked as no-show',
  cancelled: 'cancelled',
};

const viewingSelect = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  source: true,
  notes: true,
  outcome: true,
  confirmedAt: true,
  externalEventId: true,
  createdAt: true,
  lead: {
    select: {
      id: true,
      stage: true,
      contact: { select: { id: true, fullName: true, phoneE164: true } },
    },
  },
  property: {
    select: {
      id: true,
      reference: true,
      title: true,
      community: true,
      building: true,
      unitNo: true,
      emirate: true,
    },
  },
  agent: { select: { id: true, user: { select: { fullName: true } } } },
} as const;

/** "Tue 2 Dec, 4:30 pm" in UAE time. */
export const dubaiTime = (d: Date) =>
  d.toLocaleString('en-AE', {
    timeZone: 'Asia/Dubai',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

@Injectable()
export class ViewingsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private canManage(ctx: TenantRequestContext) {
    return hasPermission(ctx.role, 'crm:manage');
  }

  /** Agents see the viewings they run and those on their leads; managers see all. */
  private scope(ctx: TenantRequestContext): Prisma.ViewingWhereInput {
    if (this.canManage(ctx)) return {};
    const me = ownMembershipId(ctx);
    return { OR: [{ agentMembershipId: me }, { lead: { assignedMembershipId: me } }] };
  }

  list(ctx: TenantRequestContext, q: ListViewingsQuery) {
    return this.run(ctx, async (tx) => {
      const data = await tx.viewing.findMany({
        where: {
          AND: [
            this.scope(ctx),
            { startsAt: { gte: q.from, lt: q.to } },
            q.agentMembershipId ? { agentMembershipId: q.agentMembershipId } : {},
            q.leadId ? { leadId: q.leadId } : {},
            q.status ? { status: q.status } : {},
          ],
        },
        orderBy: { startsAt: 'asc' },
        take: 500,
        select: viewingSelect,
      });
      return { data };
    });
  }

  get(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const v = await tx.viewing.findFirst({
        where: { AND: [{ id }, this.scope(ctx)] },
        select: viewingSelect,
      });
      if (!v) throw notFound('Viewing');
      return v;
    });
  }

  /** Free slots for one agent on one UAE day, within working hours and around their viewings. */
  availability(ctx: TenantRequestContext, q: AvailabilityQuery) {
    return this.run(ctx, async (tx) => {
      const agent = q.agentMembershipId ?? ownMembershipId(ctx);
      // Anyone may see a colleague's free time (to hand a client over), never their viewings.
      await this.assertActiveMember(tx, agent);
      const dayStart = new Date(`${q.date}T00:00:00+04:00`);
      const range = { start: dayStart, end: new Date(dayStart.getTime() + 24 * 60 * MIN) };
      const busy = await this.busy(tx, agent, range.start, range.end);
      const slots = findFreeSlots(busy, DUBAI_DEFAULT_HOURS, range, new Date(), {
        ...DEFAULT_SLOT_OPTIONS,
        durationMinutes: q.durationMinutes,
        minNoticeMinutes: 30,
        maxSlots: 40,
      });
      return {
        agentMembershipId: agent,
        timeZone: 'Asia/Dubai',
        calendar: 'propforce',
        slots: slots.map((s) => ({ start: s.start, end: s.end })),
      };
    });
  }

  create(ctx: TenantRequestContext, input: ViewingCreateInput) {
    return this.run(ctx, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: {
          AND: [
            { id: input.leadId },
            this.canManage(ctx) ? {} : { assignedMembershipId: ownMembershipId(ctx) },
          ],
        },
        select: { id: true, stage: true, assignedMembershipId: true },
      });
      if (!lead) throw notFound('Lead');
      if (lead.stage === 'won' || lead.stage === 'lost') {
        throw new AppError(422, 'LEAD_CLOSED', 'This lead is closed. Reopen it to book a viewing.');
      }
      const property = await tx.property.findFirst({
        where: { id: input.propertyId, deletedAt: null },
        select: { id: true, reference: true, status: true },
      });
      if (!property) throw notFound('Listing');
      if (property.status !== 'active' && property.status !== 'under_offer') {
        throw new AppError(
          422,
          'LISTING_NOT_AVAILABLE',
          'Only active or under-offer listings can be viewed.',
        );
      }
      const agentId = input.agentMembershipId ?? lead.assignedMembershipId ?? ownMembershipId(ctx);
      if (agentId !== ctx.membershipId && !this.canManage(ctx)) {
        throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can book for other agents.');
      }
      await this.assertActiveMember(tx, agentId);
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(startsAt.getTime() + input.durationMinutes * MIN);
      this.assertFuture(startsAt);
      await this.assertFree(tx, agentId, startsAt, endsAt);
      const status = input.status;
      const v = await tx.viewing.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: lead.id,
          propertyId: property.id,
          agentMembershipId: agentId,
          startsAt,
          endsAt,
          status,
          source: 'agent',
          notes: input.notes ?? null,
          confirmedAt: status === 'confirmed' ? new Date() : null,
          createdBy: ctx.userId,
        },
        select: viewingSelect,
      });
      if (status === 'confirmed') await this.advanceLead(tx, ctx, lead.id, lead.stage);
      await this.note(
        tx,
        ctx,
        lead.id,
        `Viewing ${STATUS_TEXT[status]} for ${property.reference} on ${dubaiTime(startsAt)} with ${v.agent.user.fullName}`,
      );
      await audit(tx, ctx, {
        action: 'viewing.created',
        entityType: 'viewing',
        entityId: v.id,
        after: { leadId: lead.id, propertyId: property.id, startsAt, status },
      });
      return v;
    });
  }

  update(ctx: TenantRequestContext, id: string, input: ViewingUpdateInput) {
    return this.run(ctx, async (tx) => {
      const before = await this.find(tx, ctx, id);
      if (!BLOCKING.includes(before.status)) {
        throw new AppError(422, 'VIEWING_CLOSED', 'This viewing is already closed.');
      }
      const agentId = input.agentMembershipId ?? before.agentMembershipId;
      if (agentId !== before.agentMembershipId) {
        if (!this.canManage(ctx)) {
          throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can change the agent.');
        }
        await this.assertActiveMember(tx, agentId);
      }
      const startsAt = input.startsAt ? new Date(input.startsAt) : before.startsAt;
      const duration =
        input.durationMinutes ?? (before.endsAt.getTime() - before.startsAt.getTime()) / MIN;
      const endsAt = new Date(startsAt.getTime() + duration * MIN);
      const moved =
        startsAt.getTime() !== before.startsAt.getTime() || agentId !== before.agentMembershipId;
      if (moved) this.assertFuture(startsAt);
      await this.assertFree(tx, agentId, startsAt, endsAt, id);
      const v = await tx.viewing.update({
        where: { id },
        data: {
          startsAt,
          endsAt,
          agentMembershipId: agentId,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
        },
        select: viewingSelect,
      });
      if (startsAt.getTime() !== before.startsAt.getTime()) {
        await this.note(
          tx,
          ctx,
          before.leadId,
          `Viewing for ${v.property.reference} moved from ${dubaiTime(before.startsAt)} to ${dubaiTime(startsAt)}`,
        );
      }
      await audit(tx, ctx, {
        action: 'viewing.updated',
        entityType: 'viewing',
        entityId: id,
        before: { startsAt: before.startsAt, agentMembershipId: before.agentMembershipId },
        after: { startsAt, agentMembershipId: agentId },
      });
      return v;
    });
  }

  setStatus(ctx: TenantRequestContext, id: string, input: ViewingStatusInput) {
    return this.run(ctx, async (tx) => {
      const before = await this.find(tx, ctx, id);
      if (!NEXT[before.status].includes(input.status)) {
        throw new AppError(
          422,
          'INVALID_TRANSITION',
          `A ${before.status.replace('_', '-')} viewing cannot be marked ${input.status.replace('_', '-')}.`,
        );
      }
      if (
        (input.status === 'completed' || input.status === 'no_show') &&
        before.startsAt > new Date()
      ) {
        throw new AppError(422, 'VIEWING_NOT_STARTED', 'This viewing has not happened yet.');
      }
      if (input.status === 'confirmed') {
        // Re-check: another viewing may have taken the time since the request came in.
        await this.assertFree(tx, before.agentMembershipId, before.startsAt, before.endsAt, id);
      }
      const v = await tx.viewing.update({
        where: { id },
        data: {
          status: input.status,
          ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
          ...(input.status === 'confirmed' ? { confirmedAt: new Date() } : {}),
        },
        select: viewingSelect,
      });
      if (input.status === 'confirmed') {
        await this.advanceLead(tx, ctx, before.leadId, v.lead.stage);
      }
      await this.note(
        tx,
        ctx,
        before.leadId,
        `Viewing for ${v.property.reference} on ${dubaiTime(v.startsAt)} ${STATUS_TEXT[input.status]}${input.outcome ? `: ${input.outcome}` : ''}`,
      );
      await audit(tx, ctx, {
        action: `viewing.${input.status}`,
        entityType: 'viewing',
        entityId: id,
        before: { status: before.status },
        after: { status: input.status },
      });
      return v;
    });
  }

  // ───── helpers ─────

  private async find(tx: TransactionClient, ctx: TenantRequestContext, id: string) {
    const v = await tx.viewing.findFirst({ where: { AND: [{ id }, this.scope(ctx)] } });
    if (!v) throw notFound('Viewing');
    // Agents act only on viewings they run or on their own leads (scope); a manager acts on any.
    return v;
  }

  private assertFuture(startsAt: Date) {
    if (startsAt.getTime() < Date.now() - 5 * MIN) {
      throw new AppError(422, 'VIEWING_IN_PAST', 'Choose a time in the future.');
    }
  }

  private async busy(
    tx: TransactionClient,
    agentId: string,
    from: Date,
    to: Date,
    except?: string,
  ) {
    const pad = BUFFER_MINUTES * MIN;
    const rows = await tx.viewing.findMany({
      where: {
        agentMembershipId: agentId,
        status: { in: BLOCKING },
        startsAt: { lt: new Date(to.getTime() + pad) },
        endsAt: { gt: new Date(from.getTime() - pad) },
        ...(except ? { id: { not: except } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    });
    return rows.map((r) => ({ start: r.startsAt, end: r.endsAt }));
  }

  /** Refuses a time that overlaps the agent's other viewings, including travel buffer. */
  private async assertFree(
    tx: TransactionClient,
    agentId: string,
    start: Date,
    end: Date,
    except?: string,
  ) {
    // Serialize bookings per agent so two requests cannot both take the same slot.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`viewing:${agentId}`}, 0))`;
    const pad = BUFFER_MINUTES * MIN;
    const busy = await this.busy(tx, agentId, start, end, except);
    const clash = busy.find((b) =>
      overlaps({ start: new Date(start.getTime() - pad), end: new Date(end.getTime() + pad) }, b),
    );
    if (clash) {
      throw new AppError(
        409,
        'SLOT_CONFLICT',
        `The agent has another viewing at ${dubaiTime(clash.start)}. Leave ${BUFFER_MINUTES} minutes between viewings.`,
      );
    }
  }

  private async assertActiveMember(tx: TransactionClient, membershipId: string) {
    const m = await tx.membership.findFirst({
      where: { id: membershipId, status: 'active' },
      select: { id: true },
    });
    if (!m) throw new AppError(422, 'INVALID_MEMBER', 'Choose an active team member.');
    return m;
  }

  /** A confirmed viewing moves an early-stage lead to the Viewing stage. */
  private async advanceLead(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    leadId: string,
    stage: string,
  ) {
    if (!['new', 'contacted', 'qualified'].includes(stage)) return;
    await tx.lead.update({ where: { id: leadId }, data: { stage: 'viewing' } });
    await tx.leadActivity.create({
      data: {
        tenantId: ctx.tenantId,
        leadId,
        type: 'stage_changed',
        fromValue: stage,
        toValue: 'viewing',
        body: 'Viewing booked',
        actorUserId: ctx.userId,
      },
    });
  }

  private note(tx: TransactionClient, ctx: TenantRequestContext, leadId: string, body: string) {
    return tx.leadActivity.create({
      data: { tenantId: ctx.tenantId, leadId, type: 'note', body, actorUserId: ctx.userId },
    });
  }
}
