import { Inject, Injectable, Logger } from '@nestjs/common';
import { findVoiceLineForWebhook, Prisma, withTenant, type PrismaClient } from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { hasPermission } from '../tenancy/permissions';
import { audit } from '../tenancy/tenancy.service';
import { ownMembershipId, type TenantRequestContext } from '../tenancy/tenant.guard';
import type { CallReport } from './vapi-report';
import type { LineCreateBody, LineUpdateBody } from './voice.schemas';

const lineSelect = {
  id: true,
  provider: true,
  providerPhoneNumberId: true,
  phoneE164: true,
  label: true,
  transcriptPolicy: true,
  active: true,
  createdAt: true,
} as const;

@Injectable()
export class VoiceService {
  private readonly log = new Logger(VoiceService.name);
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /**
   * Stores a finished call for the agency that owns the line. Idempotent on the provider's call id.
   * The caller is matched to a contact by phone, or added as a new contact (source "phone") with
   * no consent recorded: an inbound call is not consent to marketing.
   */
  async recordCall(report: CallReport): Promise<'stored' | 'duplicate' | 'unknown_line'> {
    const line = await findVoiceLineForWebhook(this.prisma, report.providerPhoneNumberId);
    if (!line) return 'unknown_line';
    const tenantId = line.tenantId;
    try {
      return await withTenant(this.prisma, { tenantId }, async (tx) => {
        const exists = await tx.voiceCall.findUnique({
          where: { tenantId_providerCallId: { tenantId, providerCallId: report.providerCallId } },
          select: { id: true },
        });
        if (exists) return 'duplicate' as const;
        let contactId: string | null = null;
        if (report.callerE164 && report.direction === 'inbound') {
          const contact =
            (await tx.contact.findUnique({
              where: { tenantId_phoneE164: { tenantId, phoneE164: report.callerE164 } },
              select: { id: true },
            })) ??
            (await tx.contact.create({
              data: {
                tenantId,
                fullName: report.callerE164,
                phoneE164: report.callerE164,
                source: 'phone',
                // No signed-in user created this contact; attribute it to whoever added the line.
                createdBy: line.createdBy,
              },
              select: { id: true },
            }));
          contactId = contact.id;
        }
        await tx.voiceCall.create({
          data: {
            tenantId,
            lineId: line.id,
            providerCallId: report.providerCallId,
            direction: report.direction,
            callerE164: report.callerE164,
            contactId,
            startedAt: report.startedAt,
            endedAt: report.endedAt,
            durationSec: report.durationSec,
            costUsd: report.costUsd,
            endedReason: report.endedReason,
            summary: report.summary,
            transcript: line.transcriptPolicy === 'full_transcript' ? report.transcript : null,
          },
        });
        return 'stored' as const;
      });
    } catch (e) {
      // Two deliveries of the same report racing: the unique key keeps one.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return 'duplicate';
      }
      this.log.error({ err: (e as Error).message }, 'Could not store call');
      throw e;
    }
  }

  listCalls(
    ctx: TenantRequestContext,
    q: {
      contactId?: string | undefined;
      direction?: 'inbound' | 'outbound' | undefined;
      limit: number;
    },
  ) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const all = hasPermission(ctx.role, 'crm:manage');
      const rows = await tx.voiceCall.findMany({
        where: {
          ...(q.contactId ? { contactId: q.contactId } : {}),
          ...(q.direction ? { direction: q.direction } : {}),
          // Agents see calls from contacts they own.
          ...(all ? {} : { contact: { ownerMembershipId: ownMembershipId(ctx) } }),
        },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        select: {
          id: true,
          direction: true,
          callerE164: true,
          startedAt: true,
          durationSec: true,
          endedReason: true,
          summary: true,
          costUsd: true,
          status: true,
          outcome: true,
          error: true,
          createdAt: true,
          contact: { select: { id: true, fullName: true } },
          line: { select: { label: true, phoneE164: true } },
          script: { select: { id: true, name: true } },
        },
      });
      return {
        data: rows.map((r) => ({ ...r, costUsd: r.costUsd == null ? null : Number(r.costUsd) })),
      };
    });
  }

  getCall(ctx: TenantRequestContext, id: string) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const all = hasPermission(ctx.role, 'crm:manage');
      const call = await tx.voiceCall.findFirst({
        where: { id, ...(all ? {} : { contact: { ownerMembershipId: ownMembershipId(ctx) } }) },
        include: {
          contact: { select: { id: true, fullName: true } },
          line: { select: { label: true, phoneE164: true, transcriptPolicy: true } },
          script: { select: { id: true, name: true, questions: true } },
        },
      });
      if (!call) throw new AppError(404, 'NOT_FOUND', 'Call not found.');
      return { ...call, costUsd: call.costUsd == null ? null : Number(call.costUsd) };
    });
  }

  listLines(ctx: TenantRequestContext) {
    return withTenant(this.prisma, ctx, async (tx) => ({
      data: await tx.voiceLine.findMany({ orderBy: { createdAt: 'asc' }, select: lineSelect }),
    }));
  }

  /** Numbers are assigned by PropForce: only platform admins add them to an agency. */
  async createLine(ctx: TenantRequestContext, body: LineCreateBody) {
    const user = await this.prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { isPlatformAdmin: true },
    });
    if (!user?.isPlatformAdmin) {
      throw new AppError(
        403,
        'PERMISSION_DENIED',
        'Calling numbers are set up by PropForce. Contact support to add one.',
      );
    }
    try {
      return await withTenant(this.prisma, ctx, async (tx) => {
        const line = await tx.voiceLine.create({
          data: {
            tenantId: ctx.tenantId,
            provider: 'vapi',
            providerPhoneNumberId: body.providerPhoneNumberId,
            phoneE164: body.phoneE164 ?? null,
            label: body.label || null,
            transcriptPolicy: body.transcriptPolicy,
            createdBy: ctx.userId,
          },
          select: lineSelect,
        });
        await audit(tx, ctx, {
          action: 'voice.line_added',
          entityType: 'voice_line',
          entityId: line.id,
          after: { providerPhoneNumberId: line.providerPhoneNumberId, phoneE164: line.phoneE164 },
        });
        return line;
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new AppError(409, 'CONFLICT', 'This phone number is already connected.');
      }
      throw e;
    }
  }

  updateLine(ctx: TenantRequestContext, id: string, body: LineUpdateBody) {
    return withTenant(this.prisma, ctx, async (tx) => {
      const before = await tx.voiceLine.findFirst({
        where: { id, tenantId: ctx.tenantId },
        select: lineSelect,
      });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Line not found.');
      const after = await tx.voiceLine.update({ where: { id }, data: body, select: lineSelect });
      await audit(tx, ctx, {
        action: 'voice.line_updated',
        entityType: 'voice_line',
        entityId: id,
        before: {
          label: before.label,
          transcriptPolicy: before.transcriptPolicy,
          active: before.active,
        },
        after: {
          label: after.label,
          transcriptPolicy: after.transcriptPolicy,
          active: after.active,
        },
      });
      return after;
    });
  }
}
