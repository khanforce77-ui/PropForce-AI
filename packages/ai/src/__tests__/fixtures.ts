import type { AiRunRecord, RunSink } from '../orchestrator';
import { InMemoryRateLimiter, ToolGateway, type ToolHandlers } from '../tools/gateway';
import { AI_PERMISSIONS, type AuditSink, type ToolAuditRecord, type ToolContext } from '../types';

export const TENANT_A = '0197a000-0000-7000-8000-00000000000a';
export const PROP_1 = '0197a000-0000-7000-8000-000000000101';
export const PROP_2 = '0197a000-0000-7000-8000-000000000102';

export const ctx = (over: Partial<ToolContext> = {}): ToolContext => ({
  tenantId: TENANT_A,
  conversationId: '0197a000-0000-7000-8000-0000000000c1',
  contactId: '0197a000-0000-7000-8000-0000000000d1',
  runId: 'run-1',
  assignedAgentPermissions: new Set(AI_PERMISSIONS),
  viewingAutoConfirm: false,
  ...over,
});

export class MemoryAudit implements AuditSink {
  readonly records: ToolAuditRecord[] = [];
  async recordToolCall(r: ToolAuditRecord) {
    this.records.push(r);
  }
}

export class MemoryRuns implements RunSink {
  readonly records: AiRunRecord[] = [];
  async recordRun(r: AiRunRecord) {
    this.records.push(r);
  }
}

export const marinaListing = {
  propertyId: PROP_1,
  reference: 'MH-S-00412',
  priceAed: 1_850_000,
  bedrooms: 2,
  areaSqft: 1245,
  community: 'Dubai Marina',
  status: 'active',
};

/** Fake domain handlers that record calls; each returns minimal data. */
export const fakeHandlers = (
  calls: { name: string; input: unknown; tenantId: string; preAuthorized: boolean }[] = [],
) => {
  const rec =
    (name: string, out: Awaited<ReturnType<ToolHandlers[keyof ToolHandlers]>>) =>
    async (input: unknown, c: ToolContext, m: { preAuthorized: boolean }) => {
      calls.push({ name, input, tenantId: c.tenantId, preAuthorized: m.preAuthorized });
      return out;
    };
  const handlers: ToolHandlers = {
    search_properties: rec('search_properties', {
      data: [
        {
          id: PROP_1,
          reference: 'MH-S-00412',
          price: 1_850_000,
          beds: 2,
          areaSqft: 1245,
          community: 'Dubai Marina',
        },
      ],
      facts: [marinaListing],
    }),
    get_property_details: rec('get_property_details', {
      data: marinaListing,
      facts: [marinaListing],
    }),
    create_lead: rec('create_lead', { data: { leadId: 'lead-1' } }),
    update_lead_requirement: rec('update_lead_requirement', { data: { requirementId: 'req-1' } }),
    get_client_history: rec('get_client_history', { data: { summary: 'new client' } }),
    suggest_property_matches: rec('suggest_property_matches', { data: [] }),
    check_agent_availability: rec('check_agent_availability', { data: [] }),
    request_viewing_booking: async (input, c, m) => {
      calls.push({
        name: 'request_viewing_booking',
        input,
        tenantId: c.tenantId,
        preAuthorized: m.preAuthorized,
      });
      return { data: { viewingId: 'v-1', status: m.preAuthorized ? 'confirmed' : 'requested' } };
    },
    create_followup_task: rec('create_followup_task', { data: { taskId: 't-1' } }),
    calculate_property_costs: rec('calculate_property_costs', {
      data: { isEstimate: true, lines: [{ code: 'dld_transfer', amount: 74_000 }] },
      amountsAed: [74_000],
    }),
    notify_assigned_agent: rec('notify_assigned_agent', { data: { notified: true } }),
    request_human_handover: rec('request_human_handover', { data: { handedOver: true } }),
  };
  return handlers;
};

export const makeGateway = (opts: { canSpend?: boolean; handlers?: ToolHandlers } = {}) => {
  const audit = new MemoryAudit();
  const calls: { name: string; input: unknown; tenantId: string; preAuthorized: boolean }[] = [];
  const spend = { canSpend: async () => opts.canSpend ?? true };
  const gateway = new ToolGateway({
    handlers: opts.handlers ?? fakeHandlers(calls),
    audit,
    rateLimiter: new InMemoryRateLimiter(),
    spend,
  });
  return { gateway, audit, calls, spend };
};
