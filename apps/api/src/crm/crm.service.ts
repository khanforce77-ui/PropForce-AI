import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  withTenant,
  type LeadStage,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import { ownMembershipId, type TenantRequestContext } from '../tenancy/tenant.guard';
import { currentConsent } from './consent';
import { parseBulkLine } from './crm.schemas';
import type {
  ConsentInput,
  ContactBulkInput,
  ContactCreateInput,
  ContactUpdateInput,
  LeadCreateInput,
  LeadStageInput,
  LeadUpdateInput,
  ListContactsQuery,
  ListLeadsQuery,
} from './crm.schemas';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const CLOSED_STAGES: readonly LeadStage[] = ['won', 'lost'];
const DAY_MS = 86_400_000;

const memberSelect = { select: { id: true, user: { select: { fullName: true } } } } as const;

const contactListSelect = {
  id: true,
  fullName: true,
  phoneE164: true,
  email: true,
  source: true,
  tags: true,
  doNotContact: true,
  createdAt: true,
  updatedAt: true,
  owner: memberSelect,
  _count: { select: { leads: true } },
} as const;

const leadListSelect = {
  id: true,
  intent: true,
  stage: true,
  source: true,
  emirate: true,
  communities: true,
  propertyTypes: true,
  bedroomsMin: true,
  bedroomsMax: true,
  budgetMin: true,
  budgetMax: true,
  nextFollowUpAt: true,
  createdAt: true,
  updatedAt: true,
  contact: { select: { id: true, fullName: true, phoneE164: true, email: true } },
  assigned: memberSelect,
  property: { select: { id: true, reference: true, title: true } },
} as const;

@Injectable()
export class CrmService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private canManage(ctx: TenantRequestContext) {
    return hasPermission(ctx.role, 'crm:manage');
  }

  /** Agents see contacts they own or that have a lead assigned to them; managers see all. */
  private contactScope(ctx: TenantRequestContext): Prisma.ContactWhereInput {
    if (this.canManage(ctx)) return {};
    return {
      OR: [
        { ownerMembershipId: ownMembershipId(ctx) },
        { leads: { some: { assignedMembershipId: ownMembershipId(ctx) } } },
      ],
    };
  }

  /** Agents see only the leads assigned to them; managers see all. */
  private leadScope(ctx: TenantRequestContext): Prisma.LeadWhereInput {
    return this.canManage(ctx) ? {} : { assignedMembershipId: ownMembershipId(ctx) };
  }

  // ───── contacts ─────

  listContacts(ctx: TenantRequestContext, q: ListContactsQuery) {
    return this.run(ctx, async (tx) => {
      const where: Prisma.ContactWhereInput = {
        AND: [
          { tenantId: ctx.tenantId },
          this.contactScope(ctx),
          q.mine && ctx.membershipId ? { ownerMembershipId: ctx.membershipId } : {},
          q.q
            ? {
                OR: [
                  { fullName: { contains: q.q, mode: 'insensitive' } },
                  { email: { contains: q.q, mode: 'insensitive' } },
                  { phoneE164: { contains: q.q.replace(/[\s()-]/g, '') } },
                  { tags: { has: q.q } },
                ],
              }
            : {},
        ],
      };
      const [rows, total] = await Promise.all([
        tx.contact.findMany({
          where,
          select: contactListSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        }),
        tx.contact.count({ where }),
      ]);
      const hasMore = rows.length > q.limit;
      const data = hasMore ? rows.slice(0, q.limit) : rows;
      return { data, total, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
    });
  }

  getContact(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { AND: [{ id, tenantId: ctx.tenantId }, this.contactScope(ctx)] },
        include: {
          owner: memberSelect,
          consents: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 },
          leads: {
            where: this.leadScope(ctx),
            select: leadListSelect,
            orderBy: { createdAt: 'desc' },
          },
        },
      });
      if (!contact) throw notFound('Contact');
      return { ...contact, consentState: currentConsent(contact.consents) };
    });
  }

  createContact(ctx: TenantRequestContext, input: ContactCreateInput) {
    return this.run(ctx, async (tx) => {
      const ownerMembershipId = await this.resolveOwner(tx, ctx, input.ownerMembershipId);
      await this.assertPhoneFree(tx, ctx, input.phone ?? null);
      const contact = await tx.contact
        .create({
          data: {
            tenantId: ctx.tenantId,
            fullName: input.fullName,
            phoneE164: input.phone ?? null,
            email: input.email ?? null,
            nationality: input.nationality ?? null,
            preferredLanguage: input.preferredLanguage ?? null,
            source: input.source ?? 'manual',
            ownerMembershipId,
            tags: input.tags ?? [],
            notes: input.notes ?? null,
            doNotContact: input.doNotContact ?? false,
            createdBy: ctx.userId,
          },
        })
        .catch(duplicatePhone);
      for (const c of input.consents ?? []) {
        await tx.consentRecord.create({
          data: {
            tenantId: ctx.tenantId,
            contactId: contact.id,
            channel: c.channel,
            purpose: c.purpose,
            status: 'granted',
            method: c.method,
            evidence: c.evidence ?? null,
            recordedBy: ctx.userId,
          },
        });
      }
      await audit(tx, ctx, {
        action: 'contact.created',
        entityType: 'contact',
        entityId: contact.id,
        after: { source: contact.source, consents: (input.consents ?? []).length },
      });
      return contact;
    });
  }

  /**
   * Adds many people from pasted numbers. Numbers already in the agency are reused, never
   * duplicated. Confirmed consent is recorded per contact unless they withdrew it or are marked
   * "do not contact".
   */
  bulkAddContacts(ctx: TenantRequestContext, input: ContactBulkInput) {
    return this.run(ctx, async (tx) => {
      const invalid: string[] = [];
      const parsed = new Map<string, string | null>();
      for (const raw of input.lines) {
        if (!raw.trim()) continue;
        const row = parseBulkLine(raw);
        if (!row) invalid.push(raw.trim().slice(0, 60));
        else if (!parsed.has(row.phone) || (!parsed.get(row.phone) && row.name))
          parsed.set(row.phone, row.name);
      }
      const phones = [...parsed.keys()];
      const existing = await tx.contact.findMany({
        where: { phoneE164: { in: phones } },
        select: { id: true, phoneE164: true, fullName: true, doNotContact: true },
      });
      const visible = new Set(
        (
          await tx.contact.findMany({
            where: { AND: [{ id: { in: existing.map((c) => c.id) } }, this.contactScope(ctx)] },
            select: { id: true },
          })
        ).map((c) => c.id),
      );
      const byPhone = new Map(existing.map((c) => [c.phoneE164!, c]));
      const tags = input.tag ? [input.tag] : [];

      const contacts: {
        id: string | null;
        phone: string;
        name: string;
        status: 'created' | 'existing' | 'other_agent';
      }[] = [];
      let consentRecorded = 0;
      for (const phone of phones) {
        let row = byPhone.get(phone);
        let status: 'created' | 'existing' | 'other_agent' = 'existing';
        if (!row) {
          row = await tx.contact.create({
            data: {
              tenantId: ctx.tenantId,
              fullName: parsed.get(phone) ?? phone,
              phoneE164: phone,
              source: 'import',
              ownerMembershipId: ctx.membershipId,
              tags,
              createdBy: ctx.userId,
            },
            select: { id: true, phoneE164: true, fullName: true, doNotContact: true },
          });
          status = 'created';
        } else if (!visible.has(row.id)) {
          // Someone else's contact: say so, but do not reveal or change it.
          contacts.push({ id: null, phone, name: phone, status: 'other_agent' });
          continue;
        } else if (tags.length) {
          await tx.contact.update({
            where: { id: row.id },
            data: { tags: { push: input.tag! } },
          });
        }
        if (input.consent && !row.doNotContact) {
          for (const channel of input.consent.channels) {
            const latest = await tx.consentRecord.findFirst({
              where: { contactId: row.id, channel, purpose: input.consent.purpose },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              select: { status: true },
            });
            if (latest) continue; // granted already, or withdrawn: a bulk tick never re-grants
            await tx.consentRecord.create({
              data: {
                tenantId: ctx.tenantId,
                contactId: row.id,
                channel,
                purpose: input.consent.purpose,
                status: 'granted',
                method: input.consent.method,
                evidence: 'Confirmed by the agency when adding numbers in bulk',
                recordedBy: ctx.userId,
              },
            });
            consentRecorded++;
          }
        }
        contacts.push({ id: row.id, phone, name: row.fullName, status });
      }
      await audit(tx, ctx, {
        action: 'contact.bulk_added',
        entityType: 'contact',
        entityId: null,
        after: {
          created: contacts.filter((c) => c.status === 'created').length,
          existing: contacts.filter((c) => c.status !== 'created').length,
          invalid: invalid.length,
          consentRecorded,
          consent: input.consent ?? null,
        },
      });
      return { contacts, invalid, consentRecorded };
    });
  }

  updateContact(ctx: TenantRequestContext, id: string, input: ContactUpdateInput) {
    return this.run(ctx, async (tx) => {
      const before = await tx.contact.findFirst({
        where: { AND: [{ id, tenantId: ctx.tenantId }, this.contactScope(ctx)] },
      });
      if (!before) throw notFound('Contact');
      const data: Prisma.ContactUncheckedUpdateInput = {};
      if (input.fullName !== undefined) data.fullName = input.fullName;
      if (input.phone !== undefined) {
        if (input.phone !== before.phoneE164) await this.assertPhoneFree(tx, ctx, input.phone);
        data.phoneE164 = input.phone;
      }
      if (input.email !== undefined) data.email = input.email;
      if (input.nationality !== undefined) data.nationality = input.nationality;
      if (input.preferredLanguage !== undefined) data.preferredLanguage = input.preferredLanguage;
      if (input.source !== undefined) data.source = input.source;
      if (input.tags !== undefined) data.tags = input.tags;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.doNotContact !== undefined) data.doNotContact = input.doNotContact;
      if (input.ownerMembershipId !== undefined) {
        if (!this.canManage(ctx)) {
          throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can change the owner.');
        }
        data.ownerMembershipId = await this.resolveOwner(tx, ctx, input.ownerMembershipId);
      }
      const phone = data.phoneE164 === undefined ? before.phoneE164 : data.phoneE164;
      const email = data.email === undefined ? before.email : data.email;
      if (!phone && !email) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Add a phone number or an email.', [
          { path: 'phone', message: 'Add a phone number or an email' },
        ]);
      }
      const after = await tx.contact.update({ where: { id }, data }).catch(duplicatePhone);
      await audit(tx, ctx, {
        action: 'contact.updated',
        entityType: 'contact',
        entityId: id,
        after: { fields: Object.keys(data) },
      });
      return after;
    });
  }

  /** Erasure (e.g. a data-subject request): removes the contact, its leads and consent history. */
  eraseContact(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const contact = await tx.contact.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!contact) throw notFound('Contact');
      await tx.contact.delete({ where: { id } });
      // No personal data in the audit entry: only that an erasure happened.
      await audit(tx, ctx, { action: 'contact.erased', entityType: 'contact', entityId: id });
    });
  }

  recordConsent(ctx: TenantRequestContext, contactId: string, input: ConsentInput) {
    return this.run(ctx, async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { AND: [{ id: contactId, tenantId: ctx.tenantId }, this.contactScope(ctx)] },
        select: { id: true },
      });
      if (!contact) throw notFound('Contact');
      const record = await tx.consentRecord.create({
        data: {
          tenantId: ctx.tenantId,
          contactId,
          channel: input.channel,
          purpose: input.purpose,
          status: input.status,
          method: input.method,
          evidence: input.evidence ?? null,
          recordedBy: ctx.userId,
        },
      });
      await audit(tx, ctx, {
        action: input.status === 'granted' ? 'consent.granted' : 'consent.withdrawn',
        entityType: 'contact',
        entityId: contactId,
        after: { channel: input.channel, purpose: input.purpose, method: input.method },
      });
      return record;
    });
  }

  // ───── leads ─────

  listLeads(ctx: TenantRequestContext, q: ListLeadsQuery) {
    return this.run(ctx, async (tx) => {
      const where: Prisma.LeadWhereInput = {
        AND: [
          { tenantId: ctx.tenantId },
          this.leadScope(ctx),
          q.mine && ctx.membershipId ? { assignedMembershipId: ctx.membershipId } : {},
          q.stage ? { stage: q.stage } : {},
          q.open === true ? { stage: { notIn: [...CLOSED_STAGES] } } : {},
          q.q
            ? {
                contact: {
                  OR: [
                    { fullName: { contains: q.q, mode: 'insensitive' } },
                    { email: { contains: q.q, mode: 'insensitive' } },
                    { phoneE164: { contains: q.q.replace(/[\s()-]/g, '') } },
                  ],
                },
              }
            : {},
        ],
      };
      const [rows, total] = await Promise.all([
        tx.lead.findMany({
          where,
          select: leadListSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: q.limit + 1,
          ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        }),
        tx.lead.count({ where }),
      ]);
      const hasMore = rows.length > q.limit;
      const data = hasMore ? rows.slice(0, q.limit) : rows;
      return { data, total, nextCursor: hasMore ? (data.at(-1)?.id ?? null) : null };
    });
  }

  getLead(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const lead = await tx.lead.findFirst({
        where: { AND: [{ id, tenantId: ctx.tenantId }, this.leadScope(ctx)] },
        select: {
          ...leadListSelect,
          lostReason: true,
          closedAt: true,
          utmSource: true,
          utmMedium: true,
          utmCampaign: true,
          activities: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200 },
        },
      });
      if (!lead) throw notFound('Lead');
      return lead;
    });
  }

  createLead(ctx: TenantRequestContext, input: LeadCreateInput) {
    return this.run(ctx, async (tx) => {
      const contact = await tx.contact.findFirst({
        where: { AND: [{ id: input.contactId, tenantId: ctx.tenantId }, this.contactScope(ctx)] },
        select: { id: true },
      });
      if (!contact) throw notFound('Contact');
      if (input.propertyId) {
        const property = await tx.property.findFirst({
          where: { id: input.propertyId, deletedAt: null },
          select: { id: true },
        });
        if (!property) throw notFound('Listing');
      }
      // Agents create leads for themselves; managers may assign anyone (or leave unassigned).
      let assignedMembershipId: string | null = ctx.membershipId;
      if (input.assignedMembershipId !== undefined) {
        if (!this.canManage(ctx) && input.assignedMembershipId !== ctx.membershipId) {
          throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can assign leads to others.');
        }
        assignedMembershipId = input.assignedMembershipId
          ? (await this.assertActiveMember(tx, input.assignedMembershipId)).id
          : null;
      }
      const lead = await tx.lead.create({
        data: {
          tenantId: ctx.tenantId,
          contactId: input.contactId,
          intent: input.intent,
          source: input.source ?? 'manual',
          propertyId: input.propertyId ?? null,
          assignedMembershipId,
          ...preferenceData(input),
          createdBy: ctx.userId,
        },
        select: leadListSelect,
      });
      await this.activity(tx, ctx, lead.id, { type: 'created', toValue: 'new' });
      if (input.note) await this.activity(tx, ctx, lead.id, { type: 'note', body: input.note });
      await audit(tx, ctx, {
        action: 'lead.created',
        entityType: 'lead',
        entityId: lead.id,
        after: { intent: lead.intent, assignedMembershipId },
      });
      return lead;
    });
  }

  updateLead(ctx: TenantRequestContext, id: string, input: LeadUpdateInput) {
    return this.run(ctx, async (tx) => {
      const before = await this.findLead(tx, ctx, id);
      const merged = {
        bedroomsMin: input.bedroomsMin === undefined ? before.bedroomsMin : input.bedroomsMin,
        bedroomsMax: input.bedroomsMax === undefined ? before.bedroomsMax : input.bedroomsMax,
        budgetMin:
          input.budgetMin === undefined ? decimalToNumber(before.budgetMin) : input.budgetMin,
        budgetMax:
          input.budgetMax === undefined ? decimalToNumber(before.budgetMax) : input.budgetMax,
      };
      if (
        (merged.bedroomsMin != null &&
          merged.bedroomsMax != null &&
          merged.bedroomsMin > merged.bedroomsMax) ||
        (merged.budgetMin != null &&
          merged.budgetMax != null &&
          merged.budgetMin > merged.budgetMax)
      ) {
        throw new AppError(400, 'VALIDATION_FAILED', 'Minimum must not be above maximum.', [
          { path: 'budgetMin', message: 'Minimum must not be above maximum' },
        ]);
      }
      const lead = await tx.lead.update({
        where: { id },
        data: {
          ...(input.intent !== undefined ? { intent: input.intent } : {}),
          ...preferenceData(input),
        },
        select: leadListSelect,
      });
      await audit(tx, ctx, {
        action: 'lead.updated',
        entityType: 'lead',
        entityId: id,
        after: { fields: Object.keys(input) },
      });
      return lead;
    });
  }

  setStage(ctx: TenantRequestContext, id: string, input: LeadStageInput) {
    return this.run(ctx, async (tx) => {
      const before = await this.findLead(tx, ctx, id);
      if (before.stage === input.stage) return this.leadSummary(tx, id);
      const closing = CLOSED_STAGES.includes(input.stage);
      await tx.lead.update({
        where: { id },
        data: {
          stage: input.stage,
          lostReason: input.stage === 'lost' ? (input.lostReason ?? null) : null,
          closedAt: closing ? new Date() : null,
          ...(closing ? { nextFollowUpAt: null } : {}),
        },
      });
      await this.activity(tx, ctx, id, {
        type: 'stage_changed',
        fromValue: before.stage,
        toValue: input.stage,
        body: input.stage === 'lost' ? (input.lostReason ?? null) : null,
      });
      await audit(tx, ctx, {
        action: 'lead.stage_changed',
        entityType: 'lead',
        entityId: id,
        before: { stage: before.stage },
        after: { stage: input.stage },
      });
      return this.leadSummary(tx, id);
    });
  }

  assign(ctx: TenantRequestContext, id: string, membershipId: string | null) {
    return this.run(ctx, async (tx) => {
      const before = await this.findLead(tx, ctx, id);
      const member = membershipId ? await this.assertActiveMember(tx, membershipId) : null;
      await tx.lead.update({ where: { id }, data: { assignedMembershipId: member?.id ?? null } });
      const name = member
        ? (await tx.user.findUnique({ where: { id: member.userId }, select: { fullName: true } }))
            ?.fullName
        : null;
      await this.activity(tx, ctx, id, {
        type: 'assigned',
        fromValue: before.assignedMembershipId,
        toValue: name ?? 'Unassigned',
      });
      await audit(tx, ctx, {
        action: 'lead.assigned',
        entityType: 'lead',
        entityId: id,
        before: { assignedMembershipId: before.assignedMembershipId },
        after: { assignedMembershipId: member?.id ?? null },
      });
      return this.leadSummary(tx, id);
    });
  }

  addNote(ctx: TenantRequestContext, id: string, body: string) {
    return this.run(ctx, async (tx) => {
      await this.findLead(tx, ctx, id);
      return this.activity(tx, ctx, id, { type: 'note', body });
    });
  }

  removeLead(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      await this.findLead(tx, ctx, id);
      await tx.lead.delete({ where: { id } });
      await audit(tx, ctx, { action: 'lead.deleted', entityType: 'lead', entityId: id });
    });
  }

  /** Counts for the dashboard: the agent's own leads, or the whole agency for managers. */
  summary(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const scope = { tenantId: ctx.tenantId, ...this.leadScope(ctx) };
      // Follow-ups due by the end of today in the UAE (UTC+4, no daylight saving).
      const UAE_OFFSET = 4 * 3_600_000;
      const endOfToday = new Date(
        (Math.floor((Date.now() + UAE_OFFSET) / DAY_MS) + 1) * DAY_MS - UAE_OFFSET,
      );
      const [byStage, followUpsDue, newThisWeek, contacts] = await Promise.all([
        tx.lead.groupBy({ by: ['stage'], where: scope, _count: { _all: true } }),
        tx.lead.count({
          where: {
            ...scope,
            stage: { notIn: [...CLOSED_STAGES] },
            nextFollowUpAt: { lte: endOfToday },
          },
        }),
        tx.lead.count({
          where: { ...scope, createdAt: { gte: new Date(Date.now() - 7 * DAY_MS) } },
        }),
        tx.contact.count({ where: { tenantId: ctx.tenantId, ...this.contactScope(ctx) } }),
      ]);
      const stages = Object.fromEntries(byStage.map((r) => [r.stage, r._count._all]));
      const open = byStage
        .filter((r) => !CLOSED_STAGES.includes(r.stage))
        .reduce((sum, r) => sum + r._count._all, 0);
      return { open, stages, followUpsDue, newThisWeek, contacts };
    });
  }

  // ───── helpers ─────

  private async findLead(tx: TransactionClient, ctx: TenantRequestContext, id: string) {
    const lead = await tx.lead.findFirst({
      where: { AND: [{ id, tenantId: ctx.tenantId }, this.leadScope(ctx)] },
    });
    if (!lead) throw notFound('Lead');
    return lead;
  }

  private leadSummary(tx: TransactionClient, id: string) {
    return tx.lead.findUniqueOrThrow({ where: { id }, select: leadListSelect });
  }

  private activity(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    leadId: string,
    a: {
      type: 'note' | 'stage_changed' | 'assigned' | 'created';
      body?: string | null;
      fromValue?: string | null;
      toValue?: string | null;
    },
  ) {
    return tx.leadActivity.create({
      data: {
        tenantId: ctx.tenantId,
        leadId,
        type: a.type,
        body: a.body ?? null,
        fromValue: a.fromValue ?? null,
        toValue: a.toValue ?? null,
        actorUserId: ctx.userId,
      },
    });
  }

  private async resolveOwner(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    requested: string | null | undefined,
  ): Promise<string | null> {
    if (requested === undefined) return ctx.membershipId;
    if (requested !== ctx.membershipId && !this.canManage(ctx)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only managers can choose another owner.');
    }
    return requested ? (await this.assertActiveMember(tx, requested)).id : null;
  }

  private async assertActiveMember(tx: TransactionClient, membershipId: string) {
    const member = await tx.membership.findFirst({ where: { id: membershipId, status: 'active' } });
    if (!member) throw notFound('Member');
    return member;
  }

  private async assertPhoneFree(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    phone: string | null,
  ) {
    if (!phone) return;
    const existing = await tx.contact.findFirst({
      where: { tenantId: ctx.tenantId, phoneE164: phone },
      select: { id: true },
    });
    if (existing) {
      // Only reveal which contact it is to people allowed to see every contact.
      throw new AppError(
        409,
        'CONTACT_EXISTS',
        'A contact with this phone number already exists in your agency.',
        this.canManage(ctx) ? [{ path: 'contactId', message: existing.id }] : undefined,
      );
    }
  }
}

function preferenceData(input: LeadUpdateInput | LeadCreateInput) {
  const data: Prisma.LeadUncheckedUpdateInput = {};
  if (input.emirate !== undefined) data.emirate = input.emirate;
  if (input.communities !== undefined) data.communities = input.communities;
  if (input.propertyTypes !== undefined) data.propertyTypes = input.propertyTypes;
  if (input.bedroomsMin !== undefined) data.bedroomsMin = input.bedroomsMin;
  if (input.bedroomsMax !== undefined) data.bedroomsMax = input.bedroomsMax;
  if (input.budgetMin !== undefined) data.budgetMin = input.budgetMin;
  if (input.budgetMax !== undefined) data.budgetMax = input.budgetMax;
  if (input.nextFollowUpAt !== undefined) {
    data.nextFollowUpAt = input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null;
  }
  return data as Omit<
    Prisma.LeadUncheckedCreateInput,
    'tenantId' | 'contactId' | 'intent' | 'createdBy'
  >;
}

function decimalToNumber(v: Prisma.Decimal | null) {
  return v == null ? null : Number(v);
}

function duplicatePhone(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    throw new AppError(
      409,
      'CONTACT_EXISTS',
      'A contact with this phone number already exists in your agency.',
    );
  }
  throw err;
}
