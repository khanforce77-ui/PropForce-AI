import { describe, expect, it } from 'vitest';
import { InMemoryRateLimiter, ToolGateway } from '../tools/gateway';
import { TOOL_NAMES, type ToolName } from '../tools/catalog';
import { PROP_1, TENANT_A, ctx, fakeHandlers, makeGateway, MemoryAudit } from './fixtures';

const ALL = new Set<ToolName>(TOOL_NAMES);

describe('ToolGateway', () => {
  it('executes a valid call with tenant scope from context and audits it', async () => {
    const { gateway, audit, calls } = makeGateway();
    const { result, facts } = await gateway.call(
      'search_properties',
      { listingType: 'sale', budgetMax: 2_000_000 },
      ctx(),
      ALL,
    );
    expect(result.ok).toBe(true);
    expect(facts).toHaveLength(1);
    expect(calls[0]).toMatchObject({ name: 'search_properties', tenantId: TENANT_A });
    expect(calls[0]!.input).toMatchObject({ limit: 5 });
    expect(audit.records[0]).toMatchObject({
      tool: 'search_properties',
      outcome: 'ok',
      tenantId: TENANT_A,
    });
  });

  it.each(['tenantId', 'tenant_id', 'agencyId', 'conversationId', 'userId'])(
    'refuses model-supplied scope field %s',
    async (key) => {
      const { gateway, audit, calls } = makeGateway();
      const { result } = await gateway.call(
        'search_properties',
        { listingType: 'sale', [key]: 'other-tenant' },
        ctx(),
        ALL,
      );
      expect(result).toMatchObject({ ok: false, code: 'RESERVED_ARGUMENT' });
      expect(calls).toHaveLength(0);
      expect(audit.records[0]).toMatchObject({ outcome: 'refused', code: 'RESERVED_ARGUMENT' });
    },
  );

  it('refuses unknown tools and tools outside the run allowlist', async () => {
    const { gateway, calls } = makeGateway();
    expect((await gateway.call('delete_property', {}, ctx(), ALL)).result).toMatchObject({
      code: 'TOOL_NOT_ALLOWED',
    });
    expect((await gateway.call('__proto__', {}, ctx(), ALL)).result).toMatchObject({
      code: 'TOOL_NOT_ALLOWED',
    });
    const only = new Set<ToolName>(['get_client_history']);
    expect(
      (await gateway.call('search_properties', { listingType: 'sale' }, ctx(), only)).result,
    ).toMatchObject({
      code: 'TOOL_NOT_ALLOWED',
    });
    expect(calls).toHaveLength(0);
  });

  it('rejects unknown keys and invalid values (strict schemas)', async () => {
    const { gateway, calls, audit } = makeGateway();
    const r1 = await gateway.call(
      'search_properties',
      { listingType: 'sale', sql: 'drop table' },
      ctx(),
      ALL,
    );
    const r2 = await gateway.call(
      'search_properties',
      { listingType: 'sale', limit: 500 },
      ctx(),
      ALL,
    );
    const r3 = await gateway.call(
      'get_property_details',
      { propertyId: PROP_1, reference: 'X' },
      ctx(),
      ALL,
    );
    const r4 = await gateway.call('search_properties', 'not-an-object', ctx(), ALL);
    for (const r of [r1, r2, r3, r4])
      expect(r.result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
    // Raw values of refused args are not audited, only their keys.
    expect(JSON.stringify(audit.records[0]!.args)).not.toContain('drop table');
  });

  it('never exceeds the assigned agent permissions', async () => {
    const { gateway, calls } = makeGateway();
    const c = ctx({ assignedAgentPermissions: new Set(['property:read']) });
    expect((await gateway.call('create_lead', { intent: 'buy' }, c, ALL)).result).toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    expect(
      (await gateway.call('search_properties', { listingType: 'rent' }, c, ALL)).result.ok,
    ).toBe(true);
    // Handover is always allowed.
    expect(
      (await gateway.call('request_human_handover', { reason: 'r', summary: 's' }, c, ALL)).result
        .ok,
    ).toBe(true);
    expect(calls.map((x) => x.name)).toEqual(['search_properties', 'request_human_handover']);
  });

  it('refuses sensitive tools when no agent is assigned', async () => {
    const { gateway } = makeGateway();
    const c = ctx({ assignedAgentPermissions: null });
    const { result } = await gateway.call(
      'request_viewing_booking',
      { propertyId: PROP_1, slotStart: '2026-11-25T10:00:00+04:00' },
      c,
      ALL,
    );
    expect(result).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('viewing requests need approval unless the agent pre-authorized auto-confirm', async () => {
    const { gateway, calls, audit } = makeGateway();
    const args = { propertyId: PROP_1, slotStart: '2026-11-25T10:00:00+04:00' };
    const pending = await gateway.call('request_viewing_booking', args, ctx(), ALL);
    expect(pending.result).toMatchObject({
      ok: true,
      approvalRequired: true,
      data: { status: 'requested' },
    });
    expect(audit.records[0]!.outcome).toBe('approval_required');
    const auto = await gateway.call(
      'request_viewing_booking',
      args,
      ctx({ viewingAutoConfirm: true }),
      ALL,
    );
    expect(auto.result).toMatchObject({ ok: true, data: { status: 'confirmed' } });
    expect(auto.result.ok && auto.result.approvalRequired).toBeFalsy();
    expect(calls.map((c) => c.preAuthorized)).toEqual([false, true]);
  });

  it('rate limits per conversation and tool', async () => {
    const { gateway } = makeGateway();
    const ok = [];
    for (let i = 0; i < 3; i++)
      ok.push((await gateway.call('create_lead', { intent: 'buy' }, ctx(), ALL)).result.ok);
    expect(ok).toEqual([true, true, false]);
    const other = ctx({ conversationId: '0197a000-0000-7000-8000-0000000000c2' });
    expect((await gateway.call('create_lead', { intent: 'buy' }, other, ALL)).result.ok).toBe(true);
  });

  it('blocks paid tools at the spend cap but still allows handover', async () => {
    const { gateway } = makeGateway({ canSpend: false });
    expect(
      (await gateway.call('search_properties', { listingType: 'sale' }, ctx(), ALL)).result,
    ).toMatchObject({
      code: 'SPEND_CAP_REACHED',
    });
    expect(
      (await gateway.call('request_human_handover', { reason: 'r', summary: 's' }, ctx(), ALL))
        .result.ok,
    ).toBe(true);
  });

  it('hides handler error details from the model', async () => {
    const handlers = fakeHandlers();
    handlers.get_client_history = async () => {
      throw new Error('connection to db-internal-host:5432 failed');
    };
    const audit = new MemoryAudit();
    const gateway = new ToolGateway({
      handlers,
      audit,
      rateLimiter: new InMemoryRateLimiter(),
      spend: { canSpend: async () => true },
    });
    const { result } = await gateway.call('get_client_history', {}, ctx(), ALL);
    expect(result).toMatchObject({ ok: false, code: 'HANDLER_ERROR' });
    expect(JSON.stringify(result)).not.toContain('db-internal-host');
    expect(audit.records[0]!.outcome).toBe('error');
  });
});

describe('InMemoryRateLimiter', () => {
  it('resets after the window', async () => {
    let t = 0;
    const rl = new InMemoryRateLimiter(1000, () => t);
    expect(await rl.consume('k', 1)).toBe(true);
    expect(await rl.consume('k', 1)).toBe(false);
    t = 1001;
    expect(await rl.consume('k', 1)).toBe(true);
  });
});
