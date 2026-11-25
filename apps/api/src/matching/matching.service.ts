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
import {
  BUDGET_STRETCH,
  listingTypeFor,
  rankMatches,
  scoreMatch,
  type LeadCriteria,
  type ListingFacts,
} from './match-score';

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `${what} not found.`);
const OPEN_STAGES: readonly LeadStage[] = [
  'new',
  'contacted',
  'qualified',
  'viewing',
  'negotiating',
];
/** Marks a lead note as "listing suggested"; the listing id follows. */
const SUGGESTED_PREFIX = 'suggested:';
/** Upper bound on rows scored per request; newest first. */
const CANDIDATES = 1000;

const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

/** Listings agents may suggest: active and not past their listing expiry. */
const liveListing = (now: Date): Prisma.PropertyWhereInput => ({
  status: 'active',
  deletedAt: null,
  OR: [{ listingExpiresAt: null }, { listingExpiresAt: { gt: now } }],
});

const listingSelect = {
  id: true,
  reference: true,
  title: true,
  listingType: true,
  propertyType: true,
  emirate: true,
  community: true,
  subCommunity: true,
  building: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  price: true,
  rentPeriod: true,
  createdAt: true,
  assigned: { select: { id: true, user: { select: { fullName: true } } } },
} as const;
type ListingRow = Prisma.PropertyGetPayload<{ select: typeof listingSelect }>;

const leadSelect = {
  id: true,
  intent: true,
  stage: true,
  emirate: true,
  communities: true,
  propertyTypes: true,
  bedroomsMin: true,
  bedroomsMax: true,
  budgetMin: true,
  budgetMax: true,
  createdAt: true,
  nextFollowUpAt: true,
  contact: { select: { id: true, fullName: true } },
  assigned: { select: { id: true, user: { select: { fullName: true } } } },
} as const;
type LeadRow = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

const criteria = (l: LeadRow): LeadCriteria => ({
  intent: l.intent,
  emirate: l.emirate,
  communities: l.communities,
  propertyTypes: l.propertyTypes,
  bedroomsMin: l.bedroomsMin,
  bedroomsMax: l.bedroomsMax,
  budgetMin: num(l.budgetMin),
  budgetMax: num(l.budgetMax),
});

const facts = (p: ListingRow): ListingFacts => ({
  listingType: p.listingType,
  emirate: p.emirate,
  community: p.community,
  subCommunity: p.subCommunity,
  building: p.building,
  propertyType: p.propertyType,
  bedrooms: p.bedrooms,
  price: num(p.price),
  rentPeriod: p.rentPeriod,
});

const listingOut = (p: ListingRow) => ({
  id: p.id,
  reference: p.reference,
  title: p.title,
  listingType: p.listingType,
  propertyType: p.propertyType,
  emirate: p.emirate,
  community: p.community,
  subCommunity: p.subCommunity,
  building: p.building,
  bedrooms: p.bedrooms,
  bathrooms: p.bathrooms,
  areaSqft: num(p.areaSqft),
  price: num(p.price),
  rentPeriod: p.rentPeriod,
  agent: p.assigned ? { id: p.assigned.id, fullName: p.assigned.user.fullName } : null,
});

const leadOut = (l: LeadRow) => ({
  id: l.id,
  intent: l.intent,
  stage: l.stage,
  emirate: l.emirate,
  communities: l.communities,
  bedroomsMin: l.bedroomsMin,
  bedroomsMax: l.bedroomsMax,
  budgetMin: num(l.budgetMin),
  budgetMax: num(l.budgetMax),
  nextFollowUpAt: l.nextFollowUpAt,
  contact: l.contact,
  agent: l.assigned ? { id: l.assigned.id, fullName: l.assigned.user.fullName } : null,
});

@Injectable()
export class MatchingService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  /** Agents work only the leads assigned to them; managers see all (same rule as the CRM). */
  private leadScope(ctx: TenantRequestContext): Prisma.LeadWhereInput {
    return hasPermission(ctx.role, 'crm:manage')
      ? {}
      : { assignedMembershipId: ownMembershipId(ctx) };
  }

  private async findLead(tx: TransactionClient, ctx: TenantRequestContext, id: string) {
    const lead = await tx.lead.findFirst({
      where: { AND: [{ id, tenantId: ctx.tenantId }, this.leadScope(ctx)] },
      select: leadSelect,
    });
    if (!lead) throw notFound('Lead');
    return lead;
  }

  /** Live listings that fit a lead, best first. */
  listingsForLead(ctx: TenantRequestContext, leadId: string, limit: number) {
    return this.run(ctx, async (tx) => {
      const lead = await this.findLead(tx, ctx, leadId);
      const c = criteria(lead);
      const listingType = listingTypeFor(c.intent);
      if (!listingType) {
        return {
          lead: { id: lead.id, intent: lead.intent },
          data: [],
          message: 'Sellers and landlords are owners: match their listing to buyers instead.',
        };
      }
      // Narrow in SQL on the hard rules; the scorer applies them exactly.
      const rows = await tx.property.findMany({
        where: {
          AND: [
            liveListing(new Date()),
            { listingType },
            c.emirate ? { emirate: { equals: c.emirate, mode: 'insensitive' } } : {},
            c.propertyTypes.length ? { propertyType: { in: [...c.propertyTypes] } } : {},
            // Sale prices can be bounded in SQL; rents may be monthly, so the scorer handles them.
            listingType === 'sale' && c.budgetMax != null
              ? {
                  OR: [{ price: null }, { price: { lte: c.budgetMax * (1 + BUDGET_STRETCH) } }],
                }
              : {},
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: CANDIDATES,
        select: listingSelect,
      });
      const scored = rows.flatMap((p) => {
        const match = scoreMatch(c, facts(p));
        return match ? [{ p, match, createdAt: p.createdAt }] : [];
      });
      const suggested = await this.suggestedIds(tx, lead.id);
      return {
        lead: { id: lead.id, intent: lead.intent },
        total: scored.length,
        data: rankMatches(scored, limit).map(({ p, match }) => ({
          ...match,
          listing: listingOut(p),
          suggested: suggested.has(p.id),
        })),
      };
    });
  }

  /** Open leads that a listing fits, best first. Agents see only their own leads. */
  leadsForListing(ctx: TenantRequestContext, propertyId: string, limit: number) {
    return this.run(ctx, async (tx) => {
      const p = await tx.property.findFirst({
        where: { id: propertyId, tenantId: ctx.tenantId, deletedAt: null },
        select: listingSelect,
      });
      if (!p) throw notFound('Listing');
      const intent = p.listingType === 'rent' ? 'rent' : 'buy';
      const rows = await tx.lead.findMany({
        where: {
          AND: [
            this.leadScope(ctx),
            { intent, stage: { in: [...OPEN_STAGES] } },
            { OR: [{ emirate: null }, { emirate: { equals: p.emirate, mode: 'insensitive' } }] },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: CANDIDATES,
        select: leadSelect,
      });
      const f = facts(p);
      const scored = rows.flatMap((l) => {
        const match = scoreMatch(criteria(l), f);
        return match ? [{ l, match, createdAt: l.createdAt }] : [];
      });
      return {
        listing: listingOut(p),
        total: scored.length,
        data: rankMatches(scored, limit).map(({ l, match }) => ({ ...match, lead: leadOut(l) })),
      };
    });
  }

  /**
   * Records on the lead's timeline that a listing was suggested to the client, so the agent (and
   * their manager) can see what was already sent. It does not message the client.
   */
  markSuggested(ctx: TenantRequestContext, leadId: string, propertyId: string) {
    return this.run(ctx, async (tx) => {
      const lead = await this.findLead(tx, ctx, leadId);
      const p = await tx.property.findFirst({
        where: { id: propertyId, tenantId: ctx.tenantId, deletedAt: null },
        select: { id: true, reference: true, title: true },
      });
      if (!p) throw notFound('Listing');
      const already = await this.suggestedIds(tx, lead.id);
      if (already.has(p.id)) return { suggested: true };
      await tx.leadActivity.create({
        data: {
          tenantId: ctx.tenantId,
          leadId: lead.id,
          type: 'note',
          body: `Suggested listing ${p.reference}${p.title ? ` (${p.title})` : ''}`,
          // fromValue carries the listing id so the match list can show it as already suggested.
          fromValue: `${SUGGESTED_PREFIX}${p.id}`,
          actorUserId: ctx.userId,
        },
      });
      await audit(tx, ctx, {
        action: 'lead.listing_suggested',
        entityType: 'lead',
        entityId: lead.id,
        after: { propertyId: p.id },
      });
      return { suggested: true };
    });
  }

  private async suggestedIds(tx: TransactionClient, leadId: string) {
    const rows = await tx.leadActivity.findMany({
      where: { leadId, type: 'note', fromValue: { startsWith: SUGGESTED_PREFIX } },
      select: { fromValue: true },
    });
    return new Set(rows.map((r) => r.fromValue!.slice(SUGGESTED_PREFIX.length)));
  }
}
