import { z } from 'zod';
import type { AiPermission, ToolSensitivity } from '../types';

/**
 * The AI tool catalog (API spec §8). Every input schema is `strict`, so unknown keys, including
 * scope fields such as `tenantId`, are rejected. Scope is injected from {@link ToolContext}.
 *
 * Deliberately absent: outbound sends to other contacts, deal stage changes, price/status edits,
 * deletes, reading other conversations, admin actions.
 */

const money = z.number().positive().max(1_000_000_000);
const shortText = (max: number) => z.string().trim().min(1).max(max);
const isoDateTime = z.iso.datetime({ offset: true });

const listingType = z.enum(['sale', 'rent']);
const propertyType = z.enum([
  'apartment',
  'villa',
  'townhouse',
  'penthouse',
  'duplex',
  'studio',
  'plot',
  'office',
  'retail',
  'warehouse',
  'building',
]);

const requirementFields = z
  .object({
    listingType: listingType.optional(),
    emirate: shortText(40).optional(),
    communities: z.array(shortText(80)).max(10).optional(),
    propertyTypes: z.array(propertyType).max(5).optional(),
    bedsMin: z.int().min(0).max(20).optional(),
    bedsMax: z.int().min(0).max(20).optional(),
    budgetMax: money.optional(),
    completion: z.enum(['ready', 'off_plan', 'any']).optional(),
    timeline: shortText(80).optional(),
    notes: shortText(500).optional(),
  })
  .strict();

export const toolInputSchemas = {
  search_properties: z
    .object({
      listingType,
      emirate: shortText(40).optional(),
      communities: z.array(shortText(80)).max(10).optional(),
      propertyTypes: z.array(propertyType).max(5).optional(),
      bedsMin: z.int().min(0).max(20).optional(),
      bedsMax: z.int().min(0).max(20).optional(),
      budgetMax: money.optional(),
      completion: z.enum(['ready', 'off_plan', 'any']).optional(),
      limit: z.int().min(1).max(10).default(5),
    })
    .strict(),
  get_property_details: z
    .object({
      propertyId: z.uuid().optional(),
      reference: shortText(40).optional(),
    })
    .strict()
    .refine((v) => (v.propertyId ? 1 : 0) + (v.reference ? 1 : 0) === 1, {
      message: 'Provide exactly one of propertyId or reference',
    }),
  create_lead: z
    .object({
      intent: z.enum(['buy', 'rent', 'sell', 'let', 'invest', 'other']),
      name: shortText(120).optional(),
      language: z.enum(['en', 'ar']).optional(),
    })
    .strict(),
  update_lead_requirement: z
    .object({
      requirementId: z.uuid().optional(),
      fields: requirementFields,
    })
    .strict(),
  get_client_history: z.object({}).strict(),
  suggest_property_matches: z
    .object({
      requirementId: z.uuid(),
      limit: z.int().min(1).max(5).default(5),
    })
    .strict(),
  check_agent_availability: z
    .object({ propertyId: z.uuid(), from: isoDateTime, to: isoDateTime })
    .strict()
    .refine((v) => Date.parse(v.to) > Date.parse(v.from), { message: '`to` must be after `from`' })
    .refine((v) => Date.parse(v.to) - Date.parse(v.from) <= 14 * 24 * 3600 * 1000, {
      message: 'Range must be 14 days or less',
    }),
  request_viewing_booking: z
    .object({ propertyId: z.uuid(), slotStart: isoDateTime, notes: shortText(500).optional() })
    .strict(),
  create_followup_task: z
    .object({
      title: shortText(200),
      dueAt: isoDateTime,
      assignee: z.literal('assigned_agent'),
    })
    .strict(),
  calculate_property_costs: z
    .object({
      transactionType: z.enum(['sale', 'rent']),
      price: money,
      mortgageAmount: money.optional(),
    })
    .strict(),
  notify_assigned_agent: z
    .object({ reason: shortText(300), urgency: z.enum(['low', 'normal', 'high']) })
    .strict(),
  request_human_handover: z.object({ reason: shortText(300), summary: shortText(2000) }).strict(),
} as const;

export type ToolName = keyof typeof toolInputSchemas;
export type ToolInput<N extends ToolName> = z.output<(typeof toolInputSchemas)[N]>;

export interface ToolPolicy {
  readonly permission: AiPermission;
  readonly sensitivity: ToolSensitivity;
  /** Calls allowed per conversation per rolling window (see gateway). */
  readonly ratePerConversation: number;
  readonly description: string;
}

export const TOOL_POLICIES: Record<ToolName, ToolPolicy> = {
  search_properties: {
    permission: 'property:read',
    sensitivity: 'read',
    ratePerConversation: 20,
    description:
      "Search the agency's active, recently verified listings. Only these results may be described to the client.",
  },
  get_property_details: {
    permission: 'property:read',
    sensitivity: 'read',
    ratePerConversation: 20,
    description: 'Get facts for one active listing by id or reference.',
  },
  create_lead: {
    permission: 'lead:write',
    sensitivity: 'write-low',
    ratePerConversation: 2,
    description: 'Create a lead for this conversation’s contact.',
  },
  update_lead_requirement: {
    permission: 'requirement:write',
    sensitivity: 'write-low',
    ratePerConversation: 10,
    description: 'Save what the client is looking for (budget, area, type, beds, timeline).',
  },
  get_client_history: {
    permission: 'client_history:read',
    sensitivity: 'read',
    ratePerConversation: 5,
    description: 'Summary of this client’s prior requirements and viewings.',
  },
  suggest_property_matches: {
    permission: 'match:read',
    sensitivity: 'read',
    ratePerConversation: 10,
    description: 'Ranked matches for a saved requirement, with reasons.',
  },
  check_agent_availability: {
    permission: 'availability:read',
    sensitivity: 'read',
    ratePerConversation: 10,
    description: 'Free viewing slots of the assigned agent for a property.',
  },
  request_viewing_booking: {
    permission: 'viewing:request',
    sensitivity: 'sensitive',
    ratePerConversation: 3,
    description:
      'Request a viewing. It is confirmed only if the agent pre-authorized auto-confirm; otherwise the agent must confirm.',
  },
  create_followup_task: {
    permission: 'task:write',
    sensitivity: 'write-low',
    ratePerConversation: 5,
    description: 'Create a follow-up task for the assigned agent.',
  },
  calculate_property_costs: {
    permission: 'fees:read',
    sensitivity: 'read',
    ratePerConversation: 5,
    description: 'Estimate purchase or rental costs from the verified fee schedule.',
  },
  notify_assigned_agent: {
    permission: 'agent:notify',
    sensitivity: 'write-low',
    ratePerConversation: 3,
    description: 'Notify the assigned agent about this conversation.',
  },
  request_human_handover: {
    permission: 'handover:request',
    sensitivity: 'always-allowed',
    ratePerConversation: 5,
    description: 'Hand the conversation to a human agent. Always allowed.',
  },
};

export const TOOL_NAMES = Object.keys(toolInputSchemas) as ToolName[];

/** Scope fields the model must never supply, checked before schema validation for clear audit. */
export const RESERVED_ARGUMENT_KEYS = [
  'tenantId',
  'tenant_id',
  'agencyId',
  'conversationId',
  'contactId',
  'actingPrincipal',
  'userId',
  'runId',
] as const;

/** JSON Schema for each tool, for the LLM provider's function-calling definitions. */
export const toolJsonSchemas = (allowed: readonly ToolName[]) =>
  allowed.map((name) => ({
    name,
    description: TOOL_POLICIES[name].description,
    parameters: z.toJSONSchema(toolInputSchemas[name], { io: 'input' }),
  }));
