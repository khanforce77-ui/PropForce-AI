import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  withTenant,
  type CampaignStatus,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import { checkOutboundSend, type SendResult, type WhatsAppClient } from '@propforce/whatsapp';
import { AppError } from '../common/app-error';
import { mayContact } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { EncryptionService } from '../security/encryption.service';
import { audit } from '../tenancy/tenancy.service';
import type { TenantRequestContext } from '../tenancy/tenant.guard';
import { tokenAad } from '../whatsapp/conversations.service';
import { WHATSAPP_CLIENT } from '../whatsapp/whatsapp.providers';
import type { Audience, CampaignCreateInput, CampaignUpdateInput } from './campaigns.schemas';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Campaign not found.');
const DAY_MS = 86_400_000;
/** Messages per send call: small enough to finish well inside a serverless request. */
export const BATCH_SIZE = 25;
/** A reply within this many days of a campaign message counts as a reply to it. */
export const REPLY_WINDOW_DAYS = 7;
/** Most contacts one campaign may target. */
const MAX_AUDIENCE = 5000;

export type SkipReason = 'no_phone' | 'do_not_contact' | 'no_marketing_consent';
export const SKIP_TEXT: Record<SkipReason, string> = {
  no_phone: 'No mobile number',
  do_not_contact: 'Marked do not contact',
  no_marketing_consent: 'No WhatsApp marketing consent',
};

const campaignSelect = {
  id: true,
  name: true,
  templateName: true,
  languageCode: true,
  bodyParams: true,
  audience: true,
  status: true,
  dailyLimit: true,
  createdBy: true,
  submittedAt: true,
  approvedBy: true,
  approvedAt: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  createdAt: true,
  account: { select: { id: true, displayPhoneNumber: true, status: true } },
} as const;

/** Fills {first_name}, {full_name} and {agency_name} in a body parameter. */
export function renderParam(template: string, v: { fullName: string; agencyName: string }): string {
  const first = v.fullName.trim().split(/\s+/)[0] ?? '';
  return template
    .replaceAll('{first_name}', first)
    .replaceAll('{full_name}', v.fullName.trim())
    .replaceAll('{agency_name}', v.agencyName)
    .trim();
}

/** Contacts matching a segment. Leads narrow it when any lead filter is set. */
export function audienceWhere(a: Audience): Prisma.ContactWhereInput {
  const lead: Prisma.LeadWhereInput[] = [];
  if (a.stages?.length) lead.push({ stage: { in: a.stages } });
  if (a.intents?.length) lead.push({ intent: { in: a.intents } });
  if (a.emirate) lead.push({ emirate: { equals: a.emirate, mode: 'insensitive' } });
  if (a.communities?.length) lead.push({ communities: { hasSome: a.communities } });
  return {
    AND: [
      a.tags?.length ? { tags: { hasSome: a.tags } } : {},
      a.sources?.length ? { source: { in: a.sources } } : {},
      lead.length ? { leads: { some: { AND: lead } } } : {},
    ],
  };
}

/**
 * Lead Booster. A campaign sends one Meta-approved template to a segment of the agency's own
 * contacts, and only to those with recorded WhatsApp marketing consent. Nothing is sent until an
 * owner or admin approves it; consent and the daily limit are checked again for every message.
 */
@Injectable()
export class CampaignsService {
  private readonly log = new Logger(CampaignsService.name);
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient | null,
    private readonly crypto: EncryptionService,
  ) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  private async find(tx: TransactionClient, id: string) {
    const c = await tx.campaign.findFirst({ where: { id }, select: campaignSelect });
    if (!c) throw notFound();
    return c;
  }

  private async counts(tx: TransactionClient, campaignId: string) {
    const rows = await tx.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId },
      _count: { _all: true },
    });
    const out = { queued: 0, skipped: 0, sent: 0, failed: 0, replied: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  }

  list(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.campaign.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: campaignSelect,
      });
      const data = [];
      for (const c of rows) data.push({ ...c, counts: await this.counts(tx, c.id) });
      return { data };
    });
  }

  senders(ctx: TenantRequestContext) {
    return this.run(ctx, async (tx) => ({
      data: await tx.whatsAppAccount.findMany({
        where: { status: 'active' },
        select: { id: true, displayPhoneNumber: true },
        orderBy: { createdAt: 'asc' },
      }),
    }));
  }

  get(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      const sentToday = await this.sentSince(tx, new Date(Date.now() - DAY_MS));
      return { ...c, counts: await this.counts(tx, id), sentLast24h: sentToday };
    });
  }

  recipients(ctx: TenantRequestContext, id: string, status?: string) {
    return this.run(ctx, async (tx) => {
      await this.find(tx, id);
      const data = await tx.campaignRecipient.findMany({
        where: { campaignId: id, ...(status ? { status: status as never } : {}) },
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        take: 500,
        select: {
          id: true,
          status: true,
          skipReason: true,
          errorCode: true,
          sentAt: true,
          repliedAt: true,
          contact: { select: { id: true, fullName: true, phoneE164: true } },
        },
      });
      return { data };
    });
  }

  create(ctx: TenantRequestContext, input: CampaignCreateInput) {
    return this.run(ctx, async (tx) => {
      await this.assertAccount(tx, input.whatsappAccountId);
      const c = await tx.campaign.create({
        data: {
          tenantId: ctx.tenantId,
          name: input.name,
          whatsappAccountId: input.whatsappAccountId,
          templateName: input.templateName,
          languageCode: input.languageCode,
          bodyParams: input.bodyParams,
          audience: input.audience as Prisma.InputJsonValue,
          dailyLimit: input.dailyLimit,
          createdBy: ctx.userId,
        },
        select: campaignSelect,
      });
      await audit(tx, ctx, {
        action: 'campaign.created',
        entityType: 'campaign',
        entityId: c.id,
        after: { name: c.name, templateName: c.templateName },
      });
      return c;
    });
  }

  update(ctx: TenantRequestContext, id: string, input: CampaignUpdateInput) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      this.assertStatus(c.status, ['draft'], 'Only drafts can be edited.');
      if (input.whatsappAccountId) await this.assertAccount(tx, input.whatsappAccountId);
      return tx.campaign.update({
        where: { id },
        data: {
          ...input,
          ...(input.audience ? { audience: input.audience as Prisma.InputJsonValue } : {}),
        },
        select: campaignSelect,
      });
    });
  }

  /** Counts who the segment reaches and why the others are left out. Writes nothing. */
  preview(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      const { eligible, skipped } = await this.resolve(tx, c.audience as Audience);
      const agency = await tx.agency.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { name: true },
      });
      const params = c.bodyParams as string[];
      return {
        matched: eligible.length + skipped.length,
        eligible: eligible.length,
        skipped: Object.fromEntries(
          (Object.keys(SKIP_TEXT) as SkipReason[]).map((r) => [
            r,
            skipped.filter((s) => s.reason === r).length,
          ]),
        ),
        sample: eligible.slice(0, 5).map((e) => ({
          fullName: e.fullName,
          params: params.map((p) =>
            renderParam(p, { fullName: e.fullName, agencyName: agency.name }),
          ),
        })),
      };
    });
  }

  /** Freezes the recipient list and asks an owner or admin to approve. */
  submit(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      this.assertStatus(c.status, ['draft'], 'This campaign was already submitted.');
      const { eligible, skipped } = await this.resolve(tx, c.audience as Audience);
      if (!eligible.length) {
        throw new AppError(
          422,
          'NO_ELIGIBLE_RECIPIENTS',
          'Nobody in this audience has agreed to WhatsApp marketing messages.',
        );
      }
      await tx.campaignRecipient.createMany({
        data: [
          ...eligible.map((e) => ({ tenantId: ctx.tenantId, campaignId: id, contactId: e.id })),
          ...skipped.map((s) => ({
            tenantId: ctx.tenantId,
            campaignId: id,
            contactId: s.id,
            status: 'skipped' as const,
            skipReason: s.reason,
          })),
        ],
      });
      await tx.campaign.update({
        where: { id },
        data: { status: 'pending_approval', submittedAt: new Date() },
      });
      await audit(tx, ctx, {
        action: 'campaign.submitted',
        entityType: 'campaign',
        entityId: id,
        after: { eligible: eligible.length, skipped: skipped.length },
      });
      return { ...(await this.find(tx, id)), counts: await this.counts(tx, id) };
    });
  }

  approve(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      this.assertStatus(
        c.status,
        ['pending_approval'],
        'Only submitted campaigns can be approved.',
      );
      await tx.campaign.update({
        where: { id },
        data: { status: 'approved', approvedBy: ctx.userId, approvedAt: new Date() },
      });
      await audit(tx, ctx, { action: 'campaign.approved', entityType: 'campaign', entityId: id });
      return { ...(await this.find(tx, id)), counts: await this.counts(tx, id) };
    });
  }

  /** Back to draft (recipients cleared) so it can be changed and submitted again. */
  reject(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      this.assertStatus(
        c.status,
        ['pending_approval', 'approved'],
        'This campaign cannot go back to draft.',
      );
      await tx.campaignRecipient.deleteMany({ where: { campaignId: id } });
      await tx.campaign.update({
        where: { id },
        data: { status: 'draft', submittedAt: null, approvedBy: null, approvedAt: null },
      });
      await audit(tx, ctx, {
        action: 'campaign.returned_to_draft',
        entityType: 'campaign',
        entityId: id,
      });
      return this.find(tx, id);
    });
  }

  cancel(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const c = await this.find(tx, id);
      this.assertStatus(
        c.status,
        ['draft', 'pending_approval', 'approved', 'sending'],
        'This campaign has already finished.',
      );
      await tx.campaign.update({
        where: { id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await audit(tx, ctx, { action: 'campaign.cancelled', entityType: 'campaign', entityId: id });
      return this.find(tx, id);
    });
  }

  /**
   * Sends the next batch. The browser calls this repeatedly while the person watches; each call
   * re-checks approval, the connection, the daily limit and every recipient's consent.
   */
  async sendBatch(ctx: TenantRequestContext, id: string) {
    if (!this.client) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp is not configured yet.');
    }
    const prepared = await this.run(ctx, async (tx) => {
      // One sender at a time per campaign.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`campaign:${id}`}, 0))`;
      const c = await this.find(tx, id);
      this.assertStatus(c.status, ['approved', 'sending'], 'Approve the campaign before sending.');
      const account = await tx.whatsAppAccount.findUniqueOrThrow({
        where: { id: c.account.id },
      });
      if (
        account.status !== 'active' ||
        (account.tokenExpiresAt && account.tokenExpiresAt <= new Date())
      ) {
        throw new AppError(409, 'INTEGRATION_DISCONNECTED', 'Reconnect the WhatsApp number first.');
      }
      const room = c.dailyLimit - (await this.sentSince(tx, new Date(Date.now() - DAY_MS)));
      if (room <= 0) {
        throw new AppError(
          429,
          'DAILY_LIMIT_REACHED',
          `The daily limit of ${c.dailyLimit} messages is reached. Continue tomorrow.`,
        );
      }
      const batch = await tx.campaignRecipient.findMany({
        where: { campaignId: id, status: 'queued' },
        orderBy: { createdAt: 'asc' },
        take: Math.min(BATCH_SIZE, room),
        select: { id: true, contact: { select: { id: true, fullName: true, phoneE164: true } } },
      });
      if (c.status === 'approved') {
        await tx.campaign.update({
          where: { id },
          data: { status: 'sending', startedAt: new Date() },
        });
      }
      const agency = await tx.agency.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { name: true },
      });
      // Consent may have been withdrawn since the list was frozen: check each one now.
      const ready: { recipientId: string; contactId: string; to: string; params: string[] }[] = [];
      for (const r of batch) {
        const consent = await mayContact(tx, r.contact.id, 'whatsapp', 'marketing');
        const decision = checkOutboundSend({
          kind: 'template',
          lastInboundAt: null,
          optedOut: !consent,
          templateApproved: true,
          hasConsent: consent,
          now: new Date(),
        });
        if (!decision.allowed || !r.contact.phoneE164) {
          await tx.campaignRecipient.update({
            where: { id: r.id },
            data: { status: 'skipped', skipReason: 'no_marketing_consent' },
          });
          continue;
        }
        ready.push({
          recipientId: r.id,
          contactId: r.contact.id,
          to: r.contact.phoneE164.replace(/^\+/, ''),
          params: (c.bodyParams as string[]).map((p) =>
            renderParam(p, { fullName: r.contact.fullName, agencyName: agency.name }),
          ),
        });
      }
      return {
        campaign: c,
        ready,
        creds: {
          phoneNumberId: account.phoneNumberId,
          accessToken: this.crypto.decrypt(account.accessTokenEnc, tokenAad(account.id)),
        },
      };
    });

    // Network calls outside the transaction.
    const results: { r: (typeof prepared.ready)[number]; res: SendResult }[] = [];
    for (const r of prepared.ready) {
      const res = await this.client.send(prepared.creds, {
        type: 'template',
        to: r.to,
        templateName: prepared.campaign.templateName,
        languageCode: prepared.campaign.languageCode,
        bodyParams: r.params,
      });
      if (!res.ok) {
        this.log.warn(
          { campaignId: id, code: res.providerCode, reason: res.providerMessage },
          'Campaign message was not accepted by Meta',
        );
      }
      results.push({ r, res });
      // A template Meta rejects will fail for everyone: stop instead of burning the list.
      if (!res.ok && (res.code === 'TEMPLATE_ERROR' || res.code === 'TOKEN_INVALID')) break;
    }

    return this.run(ctx, async (tx) => {
      const now = new Date();
      for (const { r, res } of results) {
        await tx.campaignRecipient.update({
          where: { id: r.recipientId },
          data: res.ok
            ? { status: 'sent', wamid: res.wamid, sentAt: now }
            : {
                status: 'failed',
                ...(res.providerCode !== undefined ? { errorCode: res.providerCode } : {}),
              },
        });
        if (res.ok)
          await this.logMessage(tx, ctx, prepared.campaign, r.contactId, res.wamid, r.params);
      }
      const halted = results.find(
        ({ res }) => !res.ok && (res.code === 'TEMPLATE_ERROR' || res.code === 'TOKEN_INVALID'),
      );
      const counts = await this.counts(tx, id);
      let status: CampaignStatus = 'sending';
      if (counts.queued === 0) {
        status = 'completed';
        await tx.campaign.update({ where: { id }, data: { status, completedAt: now } });
        await audit(tx, ctx, {
          action: 'campaign.completed',
          entityType: 'campaign',
          entityId: id,
          after: counts,
        });
      }
      return {
        status,
        counts,
        sentNow: results.filter((x) => x.res.ok).length,
        ...(halted
          ? {
              stopped:
                halted.res.ok === false && halted.res.code === 'TEMPLATE_ERROR'
                  ? 'WhatsApp rejected the template. Check its name, language and number of parameters in Meta.'
                  : 'WhatsApp rejected the connection token. Reconnect the number.',
            }
          : {}),
      };
    });
  }

  /** Marks the latest campaign message to this contact as replied (called on inbound messages). */
  static async recordReply(tx: TransactionClient, contactId: string, at: Date) {
    const r = await tx.campaignRecipient.findFirst({
      where: {
        contactId,
        status: 'sent',
        sentAt: { gte: new Date(at.getTime() - REPLY_WINDOW_DAYS * DAY_MS) },
      },
      orderBy: { sentAt: 'desc' },
      select: { id: true },
    });
    if (r)
      await tx.campaignRecipient.update({
        where: { id: r.id },
        data: { status: 'replied', repliedAt: at },
      });
  }

  // ───── helpers ─────

  private async resolve(tx: TransactionClient, audience: Audience) {
    const contacts = await tx.contact.findMany({
      where: audienceWhere(audience),
      select: { id: true, fullName: true, phoneE164: true, doNotContact: true },
      orderBy: { createdAt: 'asc' },
      take: MAX_AUDIENCE + 1,
    });
    if (contacts.length > MAX_AUDIENCE) {
      throw new AppError(
        422,
        'AUDIENCE_TOO_LARGE',
        `This audience has more than ${MAX_AUDIENCE} contacts. Narrow it down.`,
      );
    }
    const eligible: { id: string; fullName: string }[] = [];
    const skipped: { id: string; reason: SkipReason }[] = [];
    for (const c of contacts) {
      if (!c.phoneE164) skipped.push({ id: c.id, reason: 'no_phone' });
      else if (c.doNotContact) skipped.push({ id: c.id, reason: 'do_not_contact' });
      else if (!(await mayContact(tx, c.id, 'whatsapp', 'marketing')))
        skipped.push({ id: c.id, reason: 'no_marketing_consent' });
      else eligible.push({ id: c.id, fullName: c.fullName });
    }
    return { eligible, skipped };
  }

  private async sentSince(tx: TransactionClient, since: Date) {
    return tx.campaignRecipient.count({
      where: { status: { in: ['sent', 'replied', 'failed'] }, sentAt: { gte: since } },
    });
  }

  private async assertAccount(tx: TransactionClient, id: string) {
    const a = await tx.whatsAppAccount.findFirst({ where: { id, status: 'active' } });
    if (!a) throw new AppError(422, 'INVALID_ACCOUNT', 'Choose a connected WhatsApp number.');
  }

  private assertStatus(current: CampaignStatus, allowed: CampaignStatus[], message: string) {
    if (!allowed.includes(current)) throw new AppError(422, 'INVALID_TRANSITION', message);
  }

  /** The sent template shows in the inbox like any other message. */
  private async logMessage(
    tx: TransactionClient,
    ctx: TenantRequestContext,
    c: { id: string; name: string; templateName: string; account: { id: string } },
    contactId: string,
    wamid: string,
    params: string[],
  ) {
    const contact = await tx.contact.findUniqueOrThrow({
      where: { id: contactId },
      select: { ownerMembershipId: true },
    });
    const conv = await tx.conversation.upsert({
      where: {
        tenantId_whatsappAccountId_contactId: {
          tenantId: ctx.tenantId,
          whatsappAccountId: c.account.id,
          contactId,
        },
      },
      // A campaign reply should reach a person, not the AI.
      create: {
        tenantId: ctx.tenantId,
        whatsappAccountId: c.account.id,
        contactId,
        mode: 'human',
        assignedMembershipId: contact.ownerMembershipId,
      },
      update: { lastMessageAt: new Date() },
    });
    await tx.message.create({
      data: {
        tenantId: ctx.tenantId,
        conversationId: conv.id,
        direction: 'outbound',
        author: 'system',
        authorUserId: ctx.userId,
        wamid,
        type: 'template',
        body: `[${c.templateName}] ${params.join(' · ')}`.trim(),
        status: 'sent',
      },
    });
  }
}
