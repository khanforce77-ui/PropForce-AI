import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  findWhatsAppAccountForWebhook,
  Prisma,
  withTenant,
  type PrismaClient,
  type TransactionClient,
} from '@propforce/db';
import {
  isOptInMessage,
  isOptOutMessage,
  type InboundEvent,
  type StatusEvent,
} from '@propforce/whatsapp';
import { PRISMA } from '../database/database.module';

export type InboundOutcome =
  | { kind: 'unrouted' }
  | { kind: 'duplicate' }
  | {
      kind: 'stored';
      tenantId: string;
      conversationId: string;
      messageId: string;
      mode: 'ai' | 'human';
      optedOut: boolean;
    };

/**
 * Stores inbound WhatsApp events in the right agency. Idempotent: Meta retries deliveries, and a
 * message id (`wamid`) is stored at most once per agency, so a retry has no side effects.
 */
@Injectable()
export class InboundService {
  private readonly log = new Logger(InboundService.name);
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async handleMessage(ev: InboundEvent): Promise<InboundOutcome> {
    const account = await findWhatsAppAccountForWebhook(this.prisma, ev.phoneNumberId);
    if (!account) {
      this.log.warn({ phoneNumberId: ev.phoneNumberId }, 'WhatsApp message for an unknown number');
      return { kind: 'unrouted' };
    }
    try {
      return await withTenant(this.prisma, { tenantId: account.tenantId }, (tx) =>
        this.store(tx, account, ev),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        return { kind: 'duplicate' };
      }
      throw e;
    }
  }

  private async store(
    tx: TransactionClient,
    account: { id: string; tenantId: string; connectedBy: string },
    ev: InboundEvent,
  ): Promise<InboundOutcome> {
    const tenantId = account.tenantId;
    const phone = `+${ev.fromWaId}`;
    const contact =
      (await tx.contact.findUnique({
        where: { tenantId_phoneE164: { tenantId, phoneE164: phone } },
        select: { id: true, ownerMembershipId: true },
      })) ??
      (await tx.contact.create({
        data: {
          tenantId,
          fullName: (ev.profileName ?? '').trim().slice(0, 120) || phone,
          phoneE164: phone,
          source: 'whatsapp',
          // No signed-in user created this contact; attribute it to whoever connected the number.
          createdBy: account.connectedBy,
        },
        select: { id: true, ownerMembershipId: true },
      }));

    const conversation = await tx.conversation.upsert({
      where: {
        tenantId_whatsappAccountId_contactId: {
          tenantId,
          whatsappAccountId: account.id,
          contactId: contact.id,
        },
      },
      create: {
        tenantId,
        whatsappAccountId: account.id,
        contactId: contact.id,
        assignedMembershipId: contact.ownerMembershipId,
      },
      update: {},
    });

    // Unique (tenant_id, wamid): a retried webhook fails here and the transaction rolls back.
    const message = await tx.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: 'inbound',
        author: 'client',
        wamid: ev.wamid,
        type: ev.messageType,
        body: ev.text ?? null,
        mediaId: ev.media?.mediaId ?? null,
        mediaMimeType: ev.media?.mimeType ?? null,
        status: 'received',
        createdAt: ev.sentAt,
      },
    });

    const optOut = isOptOutMessage(ev.text);
    const lastInbound =
      !conversation.lastInboundAt || ev.sentAt > conversation.lastInboundAt
        ? ev.sentAt
        : conversation.lastInboundAt;
    const updated = await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastInboundAt: lastInbound,
        lastMessageAt: new Date(),
        unreadCount: { increment: 1 },
        // An opted-out client must never get an automated reply.
        ...(optOut ? { mode: 'human' as const } : {}),
      },
    });

    await this.applyConsent(tx, tenantId, contact.id, ev, optOut);

    return {
      kind: 'stored',
      tenantId,
      conversationId: conversation.id,
      messageId: message.id,
      mode: updated.mode,
      optedOut: optOut,
    };
  }

  /**
   * Consent from the client's own messages:
   * - STOP / إلغاء etc. withdraws WhatsApp consent for every purpose, immediately.
   * - START re-grants service messages.
   * - A client who writes first consents to service replies, unless they withdrew earlier
   *   (then only START restores it).
   */
  private async applyConsent(
    tx: TransactionClient,
    tenantId: string,
    contactId: string,
    ev: InboundEvent,
    optOut: boolean,
  ) {
    const record = (
      purpose: 'service' | 'marketing',
      status: 'granted' | 'withdrawn',
      method: string,
    ) =>
      tx.consentRecord.create({
        data: {
          tenantId,
          contactId,
          channel: 'whatsapp',
          purpose,
          status,
          method,
          evidence: `wamid:${ev.wamid}`.slice(0, 300),
        },
      });
    const auditEntry = (action: string, after: Prisma.InputJsonValue) =>
      tx.auditLog.create({
        data: {
          tenantId,
          actorType: 'system',
          action,
          entityType: 'contact',
          entityId: contactId,
          after,
        },
      });

    if (optOut) {
      await record('service', 'withdrawn', 'whatsapp_opt_out_keyword');
      await record('marketing', 'withdrawn', 'whatsapp_opt_out_keyword');
      await auditEntry('consent.withdrawn', {
        channel: 'whatsapp',
        purpose: 'all',
        method: 'whatsapp_opt_out_keyword',
      });
      return;
    }
    if (isOptInMessage(ev.text)) {
      await record('service', 'granted', 'whatsapp_opt_in_keyword');
      await auditEntry('consent.granted', {
        channel: 'whatsapp',
        purpose: 'service',
        method: 'whatsapp_opt_in_keyword',
      });
      return;
    }
    const existing = await tx.consentRecord.findFirst({
      where: { contactId, channel: 'whatsapp', purpose: 'service' },
      select: { id: true },
    });
    if (!existing) {
      await record('service', 'granted', 'client_initiated_whatsapp');
    }
  }

  async handleStatus(ev: StatusEvent): Promise<void> {
    const account = await findWhatsAppAccountForWebhook(this.prisma, ev.phoneNumberId);
    if (!account || ev.status === 'deleted') return;
    const status = ev.status;
    // Only move forward: sent → delivered → read; failed only from sent.
    const allowedFrom: ('sent' | 'delivered')[] =
      status === 'failed' || status === 'delivered'
        ? ['sent']
        : status === 'read'
          ? ['sent', 'delivered']
          : [];
    if (allowedFrom.length === 0) return;
    if (status === 'failed') {
      // No message content or customer number here: only Meta's code and reason.
      this.log.warn(
        { phoneNumberId: ev.phoneNumberId, code: ev.errorCodes[0], reason: ev.errorDetail },
        'WhatsApp message delivery failed',
      );
    }
    await withTenant(this.prisma, { tenantId: account.tenantId }, (tx) =>
      tx.message.updateMany({
        where: { wamid: ev.wamid, direction: 'outbound', status: { in: allowedFrom } },
        data: {
          status,
          statusAt: ev.at,
          ...(ev.errorCodes[0] !== undefined ? { errorCode: ev.errorCodes[0] } : {}),
        },
      }),
    );
  }
}
