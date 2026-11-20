import type { AuditSink, PropertyFact, ToolContext, ToolErrorCode, ToolResult } from '../types';
import { AI_AGENT_PERMISSIONS } from '../types';
import {
  RESERVED_ARGUMENT_KEYS,
  TOOL_POLICIES,
  toolInputSchemas,
  type ToolInput,
  type ToolName,
} from './catalog';

/** What a domain handler returns: data for the model plus any property facts it exposed. */
export interface HandlerOutput {
  readonly data: unknown;
  /** Property facts contained in `data`; the grounding validator only accepts these. */
  readonly facts?: readonly PropertyFact[];
  /** Other AED amounts in `data` that the reply may quote (e.g. fee estimate lines). */
  readonly amountsAed?: readonly number[];
  /** For sensitive tools: the action was recorded but needs a human to approve it. */
  readonly approvalRequired?: boolean;
}

export interface HandlerMeta {
  /**
   * For sensitive tools: true when the human pre-authorized the action (e.g. viewing
   * auto-confirm). When false the handler must create a pending request, never a final action.
   */
  readonly preAuthorized: boolean;
}

export type ToolHandlers = {
  [N in ToolName]: (
    input: ToolInput<N>,
    ctx: ToolContext,
    meta: HandlerMeta,
  ) => Promise<HandlerOutput>;
};

/** Per-key counter. Production uses Redis; {@link InMemoryRateLimiter} is for tests/dev. */
export interface RateLimiter {
  /** Consumes one unit; returns false when the limit for the window is exhausted. */
  consume(key: string, limit: number): Promise<boolean>;
}

export interface SpendGuard {
  /** False when the tenant's AI spend cap is reached. */
  canSpend(tenantId: string): Promise<boolean>;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly counts = new Map<string, { n: number; resetAt: number }>();
  constructor(
    private readonly windowMs = 3_600_000,
    private readonly now: () => number = Date.now,
  ) {}
  async consume(key: string, limit: number): Promise<boolean> {
    const t = this.now();
    const entry = this.counts.get(key);
    if (!entry || entry.resetAt <= t) {
      this.counts.set(key, { n: 1, resetAt: t + this.windowMs });
      return limit >= 1;
    }
    if (entry.n >= limit) return false;
    entry.n += 1;
    return true;
  }
}

export interface ToolGatewayDeps {
  readonly handlers: ToolHandlers;
  readonly audit: AuditSink;
  readonly rateLimiter: RateLimiter;
  readonly spend: SpendGuard;
  readonly now?: () => number;
}

export interface GatewayCall {
  readonly result: ToolResult;
  readonly facts: readonly PropertyFact[];
  readonly amountsAed: readonly number[];
}

const refuse = (code: ToolErrorCode, message: string): ToolResult => ({ ok: false, code, message });

/**
 * Single entry point for every model tool call: allowlist → reserved-arg check → schema →
 * permission (AI ∩ assigned agent) → rate limit → spend cap → sensitivity → execute → audit.
 * Refusals are returned to the model as tool errors (never thrown) and are always audited.
 */
export class ToolGateway {
  private readonly now: () => number;
  constructor(private readonly deps: ToolGatewayDeps) {
    this.now = deps.now ?? Date.now;
  }

  async call(
    name: string,
    rawArgs: unknown,
    ctx: ToolContext,
    allowed: ReadonlySet<ToolName>,
  ): Promise<GatewayCall> {
    const started = this.now();
    let auditArgs: unknown = argKeys(rawArgs);

    const finish = async (
      result: ToolResult,
      facts: readonly PropertyFact[] = [],
      amountsAed: readonly number[] = [],
    ): Promise<GatewayCall> => {
      await this.deps.audit.recordToolCall({
        runId: ctx.runId,
        tenantId: ctx.tenantId,
        conversationId: ctx.conversationId,
        tool: name.slice(0, 64),
        args: auditArgs,
        outcome: result.ok
          ? result.approvalRequired
            ? 'approval_required'
            : 'ok'
          : result.code === 'HANDLER_ERROR'
            ? 'error'
            : 'refused',
        ...(result.ok ? {} : { code: result.code }),
        latencyMs: this.now() - started,
        at: new Date(this.now()),
      });
      return { result, facts, amountsAed };
    };

    if (!isToolName(name) || !allowed.has(name)) {
      return finish(refuse('TOOL_NOT_ALLOWED', 'This tool is not available.'));
    }
    if (rawArgs !== null && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      const reserved = RESERVED_ARGUMENT_KEYS.filter((k) => Object.hasOwn(rawArgs, k));
      if (reserved.length > 0) {
        return finish(
          refuse('RESERVED_ARGUMENT', `Arguments may not include: ${reserved.join(', ')}`),
        );
      }
    }

    const parsed = toolInputSchemas[name].safeParse(rawArgs);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      return finish(refuse('VALIDATION_FAILED', detail));
    }
    auditArgs = parsed.data;

    const policy = TOOL_POLICIES[name];
    if (policy.sensitivity !== 'always-allowed') {
      const ceiling = ctx.assignedAgentPermissions;
      if (
        !AI_AGENT_PERMISSIONS.has(policy.permission) ||
        (ceiling !== null && !ceiling.has(policy.permission))
      ) {
        return finish(refuse('PERMISSION_DENIED', 'Not permitted for this conversation.'));
      }
      if (ceiling === null && policy.sensitivity === 'sensitive') {
        return finish(refuse('PERMISSION_DENIED', 'No agent is assigned yet; hand over instead.'));
      }
    }

    const rateKey = `ai:t:${ctx.tenantId}:c:${ctx.conversationId}:${name}`;
    if (!(await this.deps.rateLimiter.consume(rateKey, policy.ratePerConversation))) {
      return finish(refuse('RATE_LIMITED', 'Too many calls to this tool in this conversation.'));
    }
    if (
      policy.sensitivity !== 'always-allowed' &&
      !(await this.deps.spend.canSpend(ctx.tenantId))
    ) {
      return finish(refuse('SPEND_CAP_REACHED', 'AI usage cap reached for this agency.'));
    }

    const preAuthorized = name === 'request_viewing_booking' ? ctx.viewingAutoConfirm : false;
    try {
      const handler = this.deps.handlers[name] as (
        input: unknown,
        c: ToolContext,
        m: HandlerMeta,
      ) => Promise<HandlerOutput>;
      const out = await handler(parsed.data, ctx, { preAuthorized });
      const approvalRequired =
        policy.sensitivity === 'sensitive' && (!preAuthorized || out.approvalRequired === true);
      return finish(
        { ok: true, data: out.data, ...(approvalRequired ? { approvalRequired } : {}) },
        out.facts ?? [],
        out.amountsAed ?? [],
      );
    } catch {
      // Handler errors are not echoed to the model: they may contain internal details.
      return finish(
        refuse('HANDLER_ERROR', 'The action failed. Offer to connect the client with an agent.'),
      );
    }
  }
}

const isToolName = (name: string): name is ToolName => Object.hasOwn(toolInputSchemas, name);

const argKeys = (raw: unknown): unknown =>
  raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? {
        keys: Object.keys(raw)
          .slice(0, 20)
          .map((k) => k.slice(0, 40)),
      }
    : { type: Array.isArray(raw) ? 'array' : typeof raw };
