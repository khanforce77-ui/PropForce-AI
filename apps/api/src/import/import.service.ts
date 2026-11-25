import { HttpException, Inject, Injectable } from '@nestjs/common';
import { withTenant, type PrismaClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/zod';
import { contactCreateSchema, leadCreateSchema } from '../crm/crm.schemas';
import { CrmService } from '../crm/crm.service';
import { PRISMA } from '../database/database.module';
import { propertyCreateSchema } from '../inventory/inventory.schemas';
import { InventoryService } from '../inventory/inventory.service';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import { mapContactRow, mapListingRow, type RawRow } from './import-mapping';

export type RowStatus = 'ready' | 'created' | 'duplicate' | 'error';
export interface RowResult {
  /** 1-based, as in the sheet (excluding the header). */
  row: number;
  status: RowStatus;
  errors: string[];
  label: string;
  id?: string;
}

/** Placeholder id used to validate a lead before its contact exists. */
const PENDING_ID = '00000000-0000-4000-8000-000000000000';

function messages(err: unknown): string[] {
  if (err instanceof HttpException) {
    const body = err.getResponse() as {
      message?: string;
      errors?: { path: string; message: string }[];
    };
    if (body.errors?.length) return body.errors.map((e) => `${e.path}: ${e.message}`);
    return [body.message ?? 'Rejected'];
  }
  throw err;
}

function validate<T>(fn: () => T): { ok: T } | { errors: string[] } {
  try {
    return { ok: fn() };
  } catch (err) {
    return { errors: messages(err) };
  }
}

const tally = (results: RowResult[]) => {
  const out: Record<RowStatus, number> = { ready: 0, created: 0, duplicate: 0, error: 0 };
  for (const r of results) out[r.status] += 1;
  return out;
};

/**
 * Bulk import from a spreadsheet. Every row goes through the same validation, permission and
 * audit path as adding it by hand (it calls the CRM and listings services), so an import can
 * never do what the person could not do one at a time. A dry run validates and checks for
 * duplicates without writing anything.
 */
@Injectable()
export class ImportService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly crm: CrmService,
    private readonly inventory: InventoryService,
  ) {}

  /** Active members' emails → membership id, for an "Agent email" column. */
  private async members(ctx: TenantRequestContext) {
    const rows = await withTenant(
      this.prisma,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      (tx) =>
        tx.membership.findMany({
          where: { status: 'active' },
          select: { id: true, user: { select: { email: true } } },
        }),
    );
    return new Map(rows.map((m) => [m.user.email.toLowerCase(), m.id]));
  }

  private resolveAgent(
    ctx: TenantRequestContext,
    members: Map<string, string>,
    email: string | null,
    permission: 'crm:manage' | 'property:manage',
  ): { id?: string; error?: string } {
    if (!email) return {};
    const id = members.get(email);
    if (!id) return { error: `Agent: no active member with email ${email}` };
    if (id !== ctx.membershipId && !hasPermission(ctx.role, permission)) {
      return { error: 'Agent: only managers can import rows for other agents' };
    }
    return { id };
  }

  async contacts(ctx: TenantRequestContext, rows: RawRow[], dryRun: boolean) {
    const members = await this.members(ctx);
    const existing = await withTenant(
      this.prisma,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      async (tx) => {
        const r = await tx.contact.findMany({
          where: { phoneE164: { not: null } },
          select: { phoneE164: true },
        });
        return new Set(r.map((c) => c.phoneE164!));
      },
    );
    const seen = new Set<string>();
    const results: RowResult[] = [];
    for (const [i, raw] of rows.entries()) {
      const mapped = mapContactRow(raw);
      const label = String(mapped.value.contact.fullName || `Row ${i + 1}`);
      const result: RowResult = {
        row: i + 1,
        status: 'ready',
        errors: [...mapped.problems],
        label,
      };
      results.push(result);
      const agent = this.resolveAgent(ctx, members, mapped.agentEmail, 'crm:manage');
      if (agent.error) result.errors.push(agent.error);
      const contact = validate(() =>
        parseBody(contactCreateSchema, {
          ...mapped.value.contact,
          ...(agent.id ? { ownerMembershipId: agent.id } : {}),
        }),
      );
      if ('errors' in contact) result.errors.push(...contact.errors);
      const leadBody = mapped.value.lead
        ? { ...mapped.value.lead, ...(agent.id ? { assignedMembershipId: agent.id } : {}) }
        : null;
      if (leadBody) {
        const lead = validate(() =>
          parseBody(leadCreateSchema, { ...leadBody, contactId: PENDING_ID }),
        );
        if ('errors' in lead) result.errors.push(...lead.errors.map((e) => `Lead ${e}`));
      }
      if (result.errors.length || !('ok' in contact)) {
        result.status = 'error';
        continue;
      }
      const phone = contact.ok.phone ?? null;
      if (phone && (existing.has(phone) || seen.has(phone))) {
        result.status = 'duplicate';
        result.errors.push(`${phone} is already a contact`);
        continue;
      }
      if (phone) seen.add(phone);
      if (dryRun) continue;
      try {
        const created = await this.crm.createContact(ctx, contact.ok);
        result.id = created.id;
        result.status = 'created';
        if (leadBody) {
          try {
            await this.crm.createLead(
              ctx,
              parseBody(leadCreateSchema, { ...leadBody, contactId: created.id }),
            );
          } catch (err) {
            result.errors.push(...messages(err).map((e) => `Contact added, but lead not: ${e}`));
          }
        }
      } catch (err) {
        result.status = 'error';
        result.errors.push(...messages(err));
      }
    }
    return this.finish(ctx, 'contacts', results, dryRun);
  }

  async listings(ctx: TenantRequestContext, rows: RawRow[], dryRun: boolean) {
    const members = await this.members(ctx);
    const existing = await withTenant(
      this.prisma,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      async (tx) => {
        const r = await tx.property.findMany({ select: { reference: true } });
        return new Set(r.map((p) => p.reference.toLowerCase()));
      },
    );
    const seen = new Set<string>();
    const results: RowResult[] = [];
    for (const [i, raw] of rows.entries()) {
      const mapped = mapListingRow(raw);
      const v = mapped.value;
      const label =
        String(
          v.reference ??
            v.title ??
            [v.building, v.community].filter(Boolean).join(', ') ??
            `Row ${i + 1}`,
        ) || `Row ${i + 1}`;
      const result: RowResult = {
        row: i + 1,
        status: 'ready',
        errors: [...mapped.problems],
        label,
      };
      results.push(result);
      const agent = this.resolveAgent(ctx, members, mapped.agentEmail, 'property:manage');
      if (agent.error) result.errors.push(agent.error);
      const body = validate(() =>
        parseBody(propertyCreateSchema, {
          ...v,
          ...(agent.id ? { assignedMembershipId: agent.id } : {}),
        }),
      );
      if ('errors' in body) result.errors.push(...body.errors);
      if (result.errors.length || !('ok' in body)) {
        result.status = 'error';
        continue;
      }
      const ref = body.ok.reference?.toLowerCase();
      if (ref && (existing.has(ref) || seen.has(ref))) {
        result.status = 'duplicate';
        result.errors.push(`Reference ${body.ok.reference} already exists`);
        continue;
      }
      if (ref) seen.add(ref);
      if (dryRun) continue;
      try {
        const created = await this.inventory.create(ctx, body.ok);
        result.id = created.id;
        result.label = created.reference;
        result.status = 'created';
      } catch (err) {
        result.status = 'error';
        result.errors.push(...messages(err));
        // The plan's listing limit stops the rest of the file too.
        if (
          err instanceof AppError &&
          (err.getResponse() as { code?: string }).code === 'PLAN_LIMIT_REACHED'
        )
          break;
      }
    }
    return this.finish(ctx, 'listings', results, dryRun);
  }

  private async finish(
    ctx: TenantRequestContext,
    kind: 'contacts' | 'listings',
    results: RowResult[],
    dryRun: boolean,
  ) {
    const summary = tally(results);
    if (!dryRun) {
      await withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, (tx) =>
        audit(tx, ctx, {
          action: `import.${kind}`,
          entityType: kind === 'contacts' ? 'contact' : 'property',
          after: { rows: results.length, ...summary },
        }),
      );
    }
    return { dryRun, summary, results };
  }
}
