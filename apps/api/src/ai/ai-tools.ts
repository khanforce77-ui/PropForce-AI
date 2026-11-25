import {
  withTenant,
  type Prisma,
  type PrismaClient,
  type PropertyType,
  type TransactionClient,
} from '@propforce/db';
import {
  sanitizeUntrusted,
  type AiPermission,
  type HandlerOutput,
  type PropertyFact,
  type ToolContext,
  type ToolHandlers,
} from '@propforce/ai';
import { DEFAULT_SLOT_OPTIONS, DUBAI_DEFAULT_HOURS, findFreeSlots } from '@propforce/calendar';
import { estimate, type Calculator } from '../calculator/calculator';
import { effectiveFeeRules } from '../calculator/calculator.service';
import { hasPermission } from '../tenancy/permissions';

/**
 * Real handlers for the AI tool catalog, on the agency's own listings, leads and fee rules.
 *
 * Every handler runs in a tenant transaction for `ctx.tenantId` (from the WhatsApp account the
 * message arrived on, never from the model), so row-level security limits it to that agency.
 * Writes are attributed to the AI in the audit log. The AI never confirms a viewing, changes a
 * deal stage or edits a listing: those stay with people.
 */

/** Listing facts the AI may quote come only from active, unexpired listings. */
const liveListing = (now: Date): Prisma.PropertyWhereInput => ({
  status: 'active',
  deletedAt: null,
  OR: [{ listingExpiresAt: null }, { listingExpiresAt: { gt: now } }],
});

/** The catalog's property types, mapped onto the CRM's. */
const TYPE_MAP: Record<string, PropertyType> = {
  apartment: 'apartment',
  studio: 'apartment',
  duplex: 'apartment',
  villa: 'villa',
  townhouse: 'townhouse',
  penthouse: 'penthouse',
  office: 'office',
  retail: 'retail',
  warehouse: 'commercial',
  building: 'commercial',
  plot: 'land',
};
const mapTypes = (types: readonly string[] | undefined): PropertyType[] => [
  ...new Set((types ?? []).map((t) => TYPE_MAP[t]).filter((t): t is PropertyType => !!t)),
];

const OPEN_STAGES = ['new', 'contacted', 'qualified', 'viewing', 'negotiating'] as const;

const listingSelect = {
  id: true,
  reference: true,
  listingType: true,
  propertyType: true,
  completion: true,
  status: true,
  title: true,
  emirate: true,
  community: true,
  subCommunity: true,
  building: true,
  bedrooms: true,
  bathrooms: true,
  areaSqft: true,
  price: true,
  rentPeriod: true,
  furnishing: true,
  handoverDate: true,
} satisfies Prisma.PropertySelect;
type ListingRow = Prisma.PropertyGetPayload<{ select: typeof listingSelect }>;

/** Agency-written text is still data to the model: strip control characters, keep it short. */
const agencyText = (s: string | null | undefined, max: number) =>
  s ? sanitizeUntrusted(s).slice(0, max) : null;

const num = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

const toFact = (p: ListingRow): PropertyFact => ({
  propertyId: p.id,
  reference: p.reference,
  ...(p.price != null ? { priceAed: Number(p.price) } : {}),
  ...(p.bedrooms != null ? { bedrooms: p.bedrooms } : {}),
  ...(p.areaSqft != null ? { areaSqft: Number(p.areaSqft) } : {}),
  ...(p.community ? { community: p.community } : {}),
  status: p.status,
});

const toListing = (p: ListingRow) => ({
  propertyId: p.id,
  reference: p.reference,
  listingType: p.listingType,
  propertyType: p.propertyType,
  completion: p.completion,
  title: agencyText(p.title, 120),
  emirate: p.emirate,
  community: p.community,
  subCommunity: p.subCommunity,
  building: p.building,
  bedrooms: p.bedrooms,
  bathrooms: p.bathrooms,
  areaSqft: num(p.areaSqft),
  priceAed: num(p.price),
  rentPeriod: p.rentPeriod,
  furnishing: p.furnishing,
  handoverDate: p.handoverDate?.toISOString().slice(0, 10) ?? null,
});

interface Criteria {
  listingType?: 'sale' | 'rent' | undefined;
  emirate?: string | null | undefined;
  communities?: readonly string[] | undefined;
  propertyTypes?: readonly PropertyType[] | undefined;
  bedsMin?: number | null | undefined;
  bedsMax?: number | null | undefined;
  budgetMax?: number | null | undefined;
  completion?: 'ready' | 'off_plan' | 'any' | undefined;
}

/** Deterministic filters only. Any semantic ranking happens within these results, later. */
async function searchListings(tx: TransactionClient, c: Criteria, limit: number) {
  const rows = await tx.property.findMany({
    where: {
      AND: [
        liveListing(new Date()),
        c.listingType ? { listingType: c.listingType } : {},
        c.emirate ? { emirate: { equals: c.emirate, mode: 'insensitive' } } : {},
        c.communities?.length
          ? {
              OR: c.communities.map((name) => ({
                community: { equals: name, mode: 'insensitive' as const },
              })),
            }
          : {},
        c.propertyTypes?.length ? { propertyType: { in: [...c.propertyTypes] } } : {},
        c.bedsMin != null ? { bedrooms: { gte: c.bedsMin } } : {},
        c.bedsMax != null ? { bedrooms: { lte: c.bedsMax } } : {},
        c.budgetMax != null ? { price: { lte: c.budgetMax } } : {},
        c.completion && c.completion !== 'any' ? { completion: c.completion } : {},
      ],
    },
    orderBy: [{ verifiedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: limit,
    select: listingSelect,
  });
  return { data: { results: rows.map(toListing) }, facts: rows.map(toFact) };
}

/** Everything a handler needs about the conversation, loaded inside the tenant transaction. */
async function conversationScope(tx: TransactionClient, ctx: ToolContext) {
  const conv = await tx.conversation.findUniqueOrThrow({
    where: { id: ctx.conversationId },
    select: {
      id: true,
      contactId: true,
      assignedMembershipId: true,
      account: { select: { connectedBy: true } },
    },
  });
  // Defence in depth: the context must describe one consistent conversation.
  if (conv.contactId !== ctx.contactId) throw new Error('Conversation and contact do not match');
  return conv;
}

const openLead = (tx: TransactionClient, contactId: string, leadId?: string) =>
  tx.lead.findFirst({
    where: { contactId, stage: { in: [...OPEN_STAGES] }, ...(leadId ? { id: leadId } : {}) },
    orderBy: { createdAt: 'desc' },
  });

const aiAudit = (
  tx: TransactionClient,
  ctx: ToolContext,
  action: string,
  entityType: string,
  entityId: string,
  after: Prisma.InputJsonValue,
) =>
  tx.auditLog.create({
    data: {
      tenantId: ctx.tenantId,
      actorType: 'ai',
      action,
      entityType,
      entityId,
      after: { ...(after as object), runId: ctx.runId },
    },
  });

const note = (tx: TransactionClient, ctx: ToolContext, leadId: string, body: string) =>
  tx.leadActivity.create({
    data: { tenantId: ctx.tenantId, leadId, type: 'note', body: body.slice(0, 2000) },
  });

const dubaiTime = (iso: string) =>
  new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');

/**
 * Maps the assigned agent's role onto the AI permission names. The gateway lets the AI act only
 * within this set, so the AI can never do more than the person it works for.
 */
export function aiCeilingForRole(role: 'owner' | 'admin' | 'manager' | 'agent'): Set<AiPermission> {
  const out = new Set<AiPermission>(['availability:read', 'fees:read', 'handover:request']);
  if (hasPermission(role, 'property:read')) {
    out.add('property:read');
    out.add('match:read');
  }
  if (hasPermission(role, 'crm:write')) {
    for (const p of [
      'lead:write',
      'requirement:write',
      'client_history:read',
      'task:write',
      'viewing:request',
      'agent:notify',
    ] as const) {
      out.add(p);
    }
  }
  return out;
}

export function createToolHandlers(prisma: PrismaClient): ToolHandlers {
  const run = <T>(ctx: ToolContext, fn: (tx: TransactionClient) => Promise<T>) =>
    withTenant(prisma, { tenantId: ctx.tenantId }, fn);

  const handlers: ToolHandlers = {
    search_properties: (input, ctx) =>
      run(ctx, (tx) =>
        searchListings(
          tx,
          {
            listingType: input.listingType,
            emirate: input.emirate,
            communities: input.communities,
            propertyTypes: mapTypes(input.propertyTypes),
            bedsMin: input.propertyTypes?.includes('studio') ? 0 : input.bedsMin,
            bedsMax: input.propertyTypes?.includes('studio') ? 0 : input.bedsMax,
            budgetMax: input.budgetMax,
            completion: input.completion,
          },
          input.limit,
        ),
      ),

    get_property_details: (input, ctx) =>
      run(ctx, async (tx): Promise<HandlerOutput> => {
        const p = await tx.property.findFirst({
          where: {
            AND: [
              liveListing(new Date()),
              input.propertyId ? { id: input.propertyId } : { reference: input.reference! },
            ],
          },
          select: { ...listingSelect, description: true, amenities: true, parking: true },
        });
        if (!p) return { data: { found: false, message: 'No active listing with that id.' } };
        return {
          data: {
            found: true,
            ...toListing(p),
            parking: p.parking,
            amenities: p.amenities.slice(0, 20).map((a) => agencyText(a, 40)),
            description: agencyText(p.description, 600),
          },
          facts: [toFact(p)],
        };
      }),

    create_lead: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const intent = input.intent === 'invest' ? 'buy' : input.intent;
        if (intent === 'other') return { data: { created: false, message: 'Hand over instead.' } };
        const existing = await tx.lead.findFirst({
          where: { contactId: conv.contactId, intent, stage: { in: [...OPEN_STAGES] } },
          select: { id: true },
        });
        if (existing) return { data: { leadId: existing.id, created: false } };
        const lead = await tx.lead.create({
          data: {
            tenantId: ctx.tenantId,
            contactId: conv.contactId,
            intent,
            source: 'whatsapp',
            assignedMembershipId: conv.assignedMembershipId,
            createdBy: conv.account.connectedBy,
          },
          select: { id: true },
        });
        await tx.leadActivity.create({
          data: {
            tenantId: ctx.tenantId,
            leadId: lead.id,
            type: 'created',
            body: 'Created by the WhatsApp assistant.',
          },
        });
        if (input.name || input.language) {
          const contact = await tx.contact.findUniqueOrThrow({
            where: { id: conv.contactId },
            select: { fullName: true, phoneE164: true, preferredLanguage: true },
          });
          await tx.contact.update({
            where: { id: conv.contactId },
            data: {
              // Only fill gaps; never overwrite what the agency entered.
              ...(input.name && contact.fullName === contact.phoneE164
                ? { fullName: input.name }
                : {}),
              ...(input.language && !contact.preferredLanguage
                ? { preferredLanguage: input.language }
                : {}),
            },
          });
        }
        await aiAudit(tx, ctx, 'lead.created', 'lead', lead.id, { intent, source: 'whatsapp' });
        return { data: { leadId: lead.id, created: true } };
      }),

    update_lead_requirement: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const lead = await openLead(tx, conv.contactId, input.requirementId);
        if (!lead) return { data: { updated: false, message: 'Create a lead first.' } };
        const f = input.fields;
        const types = f.propertyTypes ? mapTypes(f.propertyTypes) : undefined;
        await tx.lead.update({
          where: { id: lead.id },
          data: {
            ...(f.emirate !== undefined ? { emirate: f.emirate } : {}),
            ...(f.communities !== undefined ? { communities: f.communities } : {}),
            ...(types !== undefined ? { propertyTypes: types } : {}),
            ...(f.bedsMin !== undefined ? { bedroomsMin: f.bedsMin } : {}),
            ...(f.bedsMax !== undefined ? { bedroomsMax: f.bedsMax } : {}),
            ...(f.budgetMax !== undefined ? { budgetMax: f.budgetMax } : {}),
          },
        });
        const extra = [
          f.completion ? `Completion: ${f.completion}` : null,
          f.timeline ? `Timeline: ${f.timeline}` : null,
          f.notes ? `Notes: ${f.notes}` : null,
        ].filter(Boolean);
        if (extra.length > 0) {
          await note(tx, ctx, lead.id, `From WhatsApp assistant. ${extra.join('. ')}`);
        }
        await aiAudit(tx, ctx, 'lead.requirement_updated', 'lead', lead.id, {
          fields: Object.keys(f),
        });
        return { data: { requirementId: lead.id, updated: true } };
      }),

    get_client_history: (_input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const leads = await tx.lead.findMany({
          where: { contactId: conv.contactId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            intent: true,
            stage: true,
            emirate: true,
            communities: true,
            propertyTypes: true,
            bedroomsMin: true,
            bedroomsMax: true,
            budgetMax: true,
            createdAt: true,
          },
        });
        return {
          data: {
            leads: leads.map((l) => ({
              requirementId: l.id,
              intent: l.intent,
              stage: l.stage,
              emirate: l.emirate,
              communities: l.communities,
              propertyTypes: l.propertyTypes,
              bedsMin: l.bedroomsMin,
              bedsMax: l.bedroomsMax,
              budgetMaxAed: num(l.budgetMax),
              since: l.createdAt.toISOString().slice(0, 10),
            })),
          },
          // The client's own budget may be repeated back to them.
          amountsAed: leads.map((l) => num(l.budgetMax)).filter((n): n is number => n != null),
        };
      }),

    suggest_property_matches: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const lead = await tx.lead.findFirst({
          where: { id: input.requirementId, contactId: conv.contactId },
        });
        if (!lead) return { data: { results: [], message: 'Requirement not found.' } };
        const listingType =
          lead.intent === 'rent' ? 'rent' : lead.intent === 'buy' ? 'sale' : undefined;
        if (!listingType) return { data: { results: [], message: 'No matching for this intent.' } };
        return searchListings(
          tx,
          {
            listingType,
            emirate: lead.emirate,
            communities: lead.communities,
            propertyTypes: lead.propertyTypes,
            bedsMin: lead.bedroomsMin,
            bedsMax: lead.bedroomsMax,
            budgetMax: num(lead.budgetMax),
          },
          input.limit,
        );
      }),

    // Free time on the assigned agent's PropForce calendar (working hours minus viewings).
    // Google Calendar busy times are added once agents can connect Google (OAuth pending).
    check_agent_availability: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        if (!conv.assignedMembershipId) {
          return {
            data: {
              slots: [],
              message: 'No agent is assigned yet. Ask the client for preferred times.',
            },
          };
        }
        const range = { start: new Date(input.from), end: new Date(input.to) };
        const busy = await tx.viewing.findMany({
          where: {
            agentMembershipId: conv.assignedMembershipId,
            status: { in: ['requested', 'confirmed'] },
            startsAt: { lt: range.end },
            endsAt: { gt: range.start },
          },
          select: { startsAt: true, endsAt: true },
        });
        const slots = findFreeSlots(
          busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
          DUBAI_DEFAULT_HOURS,
          range,
          new Date(),
          { ...DEFAULT_SLOT_OPTIONS, maxSlots: 6 },
        );
        return {
          data: {
            slots: slots.map((x) => ({
              start: x.start.toISOString(),
              dubaiTime: dubaiTime(x.start.toISOString()),
            })),
            message: 'Times the agent is free. The agent still confirms the viewing.',
          },
        };
      }),

    // Never a final booking: the request is recorded on the lead and the agent confirms it.
    request_viewing_booking: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const p = await tx.property.findFirst({
          where: { AND: [liveListing(new Date()), { id: input.propertyId }] },
          select: { id: true, reference: true, listingType: true },
        });
        if (!p) return { data: { status: 'not_available', message: 'Listing is not active.' } };
        const lead =
          (await openLead(tx, conv.contactId)) ??
          (await tx.lead.create({
            data: {
              tenantId: ctx.tenantId,
              contactId: conv.contactId,
              intent: p.listingType === 'rent' ? 'rent' : 'buy',
              source: 'whatsapp',
              propertyId: p.id,
              assignedMembershipId: conv.assignedMembershipId,
              createdBy: conv.account.connectedBy,
            },
          }));
        await tx.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: new Date(), ...(lead.propertyId ? {} : { propertyId: p.id }) },
        });
        await note(
          tx,
          ctx,
          lead.id,
          `Viewing requested on WhatsApp for ${p.reference} at ${dubaiTime(input.slotStart)} (Dubai time). Please confirm with the client.${input.notes ? ` Client notes: ${input.notes}` : ''}`,
        );
        // Hold the time on the agent's calendar as "requested" when it is free; the agent confirms.
        const agentId = conv.assignedMembershipId;
        if (agentId) {
          const start = new Date(input.slotStart);
          const end = new Date(start.getTime() + DEFAULT_SLOT_OPTIONS.durationMinutes * 60_000);
          const pad = DEFAULT_SLOT_OPTIONS.bufferMinutes * 60_000;
          const clash = await tx.viewing.count({
            where: {
              agentMembershipId: agentId,
              status: { in: ['requested', 'confirmed'] },
              startsAt: { lt: new Date(end.getTime() + pad) },
              endsAt: { gt: new Date(start.getTime() - pad) },
            },
          });
          if (!clash && start.getTime() > Date.now()) {
            await tx.viewing.create({
              data: {
                tenantId: ctx.tenantId,
                leadId: lead.id,
                propertyId: p.id,
                agentMembershipId: agentId,
                startsAt: start,
                endsAt: end,
                status: 'requested',
                source: 'ai',
                notes: input.notes ?? null,
                createdBy: conv.account.connectedBy,
              },
            });
          }
        }
        await aiAudit(tx, ctx, 'viewing.requested', 'lead', lead.id, {
          propertyId: p.id,
          slotStart: input.slotStart,
        });
        return {
          data: { status: 'requested', message: 'The agent will confirm the time.' },
          approvalRequired: true,
        };
      }),

    create_followup_task: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const lead = await openLead(tx, conv.contactId);
        if (!lead) return { data: { created: false, message: 'Create a lead first.' } };
        await tx.lead.update({
          where: { id: lead.id },
          data: { nextFollowUpAt: new Date(input.dueAt) },
        });
        await note(tx, ctx, lead.id, `Follow-up (from WhatsApp assistant): ${input.title}`);
        await aiAudit(tx, ctx, 'lead.followup_set', 'lead', lead.id, { dueAt: input.dueAt });
        return { data: { created: true } };
      }),

    calculate_property_costs: (input, ctx) =>
      run(ctx, async (tx): Promise<HandlerOutput> => {
        const agency = await tx.agency.findUniqueOrThrow({
          where: { id: ctx.tenantId },
          select: { emirate: true },
        });
        const calculator: Calculator =
          input.transactionType === 'rent'
            ? 'rental'
            : input.mortgageAmount
              ? 'mortgage'
              : 'ready_sale';
        const rules = (await effectiveFeeRules(tx, ctx.tenantId, agency.emirate)).filter((r) =>
          r.calculators.includes(calculator),
        );
        // Only figures the agency has verified may reach a client.
        if (rules.length === 0 || rules.some((r) => r.status !== 'verified')) {
          return {
            data: {
              available: false,
              message: 'The agency has not verified its fee schedule. The agent will share costs.',
            },
          };
        }
        const est = estimate(
          input.transactionType === 'rent'
            ? { calculator, annualRent: input.price }
            : {
                calculator,
                price: input.price,
                ...(input.mortgageAmount
                  ? {
                      downPaymentPct: Math.max(
                        0,
                        (1 - Math.min(input.mortgageAmount, input.price) / input.price) * 100,
                      ),
                    }
                  : {}),
              },
          rules,
        );
        const items = est.items.map((i) => ({
          label: i.label,
          payer: i.payer,
          totalAed: i.total,
          refundable: i.refundable,
        }));
        const amounts = [
          ...items.map((i) => i.totalAed),
          est.totals.fees,
          est.totals.refundable,
          est.totals.upfront,
          ...(est.mortgage
            ? [est.mortgage.downPayment, est.mortgage.loan, est.mortgage.monthlyPayment]
            : []),
        ];
        return {
          data: {
            available: true,
            isEstimate: true,
            emirate: agency.emirate,
            items,
            totals: est.totals,
            mortgage: est.mortgage,
          },
          amountsAed: amounts,
        };
      }),

    notify_assigned_agent: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        const lead = await openLead(tx, conv.contactId);
        if (lead) {
          await tx.lead.update({ where: { id: lead.id }, data: { nextFollowUpAt: new Date() } });
          await note(tx, ctx, lead.id, `WhatsApp assistant (${input.urgency}): ${input.reason}`);
        }
        await aiAudit(tx, ctx, 'conversation.agent_notified', 'conversation', conv.id, {
          urgency: input.urgency,
          reason: input.reason,
        });
        return { data: { notified: true } };
      }),

    request_human_handover: (input, ctx) =>
      run(ctx, async (tx) => {
        const conv = await conversationScope(tx, ctx);
        await tx.conversation.update({
          where: { id: conv.id },
          data: { mode: 'human', summary: input.summary.slice(0, 2000) },
        });
        await aiAudit(tx, ctx, 'conversation.handover', 'conversation', conv.id, {
          reason: input.reason,
        });
        return { data: { handedOver: true } };
      }),
  };
  return handlers;
}
