import type {
  AiRunRecord,
  AuditSink,
  RateLimiter,
  RunSink,
  SpendGuard,
  ToolAuditRecord,
} from '@propforce/ai';
import { withTenant, type Prisma, type PrismaClient } from '@propforce/db';

/**
 * Database-backed sinks for the AI layer. They keep state in Postgres rather than in memory, so
 * limits and the audit trail hold across serverless instances.
 */

export class PrismaAuditSink implements AuditSink {
  constructor(private readonly prisma: PrismaClient) {}
  async recordToolCall(r: ToolAuditRecord): Promise<void> {
    await withTenant(this.prisma, { tenantId: r.tenantId }, (tx) =>
      tx.aiToolCall.create({
        data: {
          tenantId: r.tenantId,
          runId: r.runId,
          conversationId: r.conversationId,
          tool: r.tool,
          args: (r.args ?? {}) as Prisma.InputJsonValue,
          outcome: r.outcome,
          code: r.code ?? null,
          latencyMs: Math.max(0, Math.round(r.latencyMs)),
          createdAt: r.at,
        },
      }),
    );
  }
}

export class PrismaRunSink implements RunSink {
  constructor(private readonly prisma: PrismaClient) {}
  async recordRun(r: AiRunRecord): Promise<void> {
    await withTenant(this.prisma, { tenantId: r.tenantId }, (tx) =>
      tx.aiRun.create({
        data: {
          id: r.runId,
          tenantId: r.tenantId,
          conversationId: r.conversationId,
          provider: r.provider.slice(0, 40),
          model: r.model.slice(0, 100),
          promptVersion: r.promptVersion,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          latencyMs: Math.max(0, Math.round(r.latencyMs)),
          outcome: r.outcome,
          handoverReason: r.handoverReason ?? null,
          injectionSuspected: r.injectionSuspected,
          groundingFailures: r.groundingFailures.map((g) => g.slice(0, 300)).slice(0, 20),
        },
      }),
    );
  }
}

/** Monthly token cap per agency, counted from recorded runs. */
export class PrismaSpendGuard implements SpendGuard {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly monthlyTokenCap: number,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async canSpend(tenantId: string): Promise<boolean> {
    if (this.monthlyTokenCap <= 0) return false;
    const n = this.now();
    const monthStart = new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1));
    const agg = await withTenant(this.prisma, { tenantId }, (tx) =>
      tx.aiRun.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    );
    return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0) < this.monthlyTokenCap;
  }
}

const RATE_KEY = /^ai:t:([0-9a-f-]{36}):c:([0-9a-f-]{36}):([a-z_]{1,64})$/;

/**
 * Per-conversation tool limits over a rolling hour, counted from the tool-call audit. The
 * gateway audits every attempt after this check, so the count includes the current hour's calls.
 * Unknown key shapes are refused (fail closed).
 */
export class PrismaRateLimiter implements RateLimiter {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly windowMs = 3_600_000,
  ) {}
  async consume(key: string, limit: number): Promise<boolean> {
    const m = RATE_KEY.exec(key);
    if (!m) return false;
    const [, tenantId, conversationId, tool] = m;
    const used = await withTenant(this.prisma, { tenantId: tenantId! }, (tx) =>
      tx.aiToolCall.count({
        where: {
          conversationId: conversationId!,
          tool: tool!,
          outcome: { in: ['ok', 'approval_required', 'error'] },
          createdAt: { gte: new Date(Date.now() - this.windowMs) },
        },
      }),
    );
    return used < limit;
  }
}
