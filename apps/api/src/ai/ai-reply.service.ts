import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiOrchestrator, TurnOutcome } from '@propforce/ai';
import { withTenant, type PrismaClient } from '@propforce/db';
import { checkOutboundSend, MAX_TEXT_LENGTH, type WhatsAppClient } from '@propforce/whatsapp';
import { BillingService } from '../billing/billing.service';
import { mayContact } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { EncryptionService } from '../security/encryption.service';
import { tokenAad } from '../whatsapp/conversations.service';
import { WHATSAPP_CLIENT } from '../whatsapp/whatsapp.providers';
import { aiCeilingForRole } from './ai-tools';

export const AI_ORCHESTRATOR = Symbol('AI_ORCHESTRATOR');

/** Inbound messages older than this are not answered by the AI (e.g. after a long takeover). */
const MAX_UNANSWERED_AGE_MS = 15 * 60_000;
const HISTORY_MESSAGES = 12;
const ARABIC = /[؀-ۿ]/;

export type ReplyResult =
  'skipped' | 'nothing_to_answer' | 'replied' | 'handover' | 'not_sent' | 'failed';

/**
 * One AI turn for a WhatsApp conversation: claim the client's unanswered messages, run the
 * orchestrator, and send its reply. Every gate fails closed: AI mode, consent, the 24-hour
 * window, an active number, and no agent reply since the turn started.
 */
@Injectable()
export class AiReplyService {
  private readonly log = new Logger(AiReplyService.name);
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient | null,
    @Inject(AI_ORCHESTRATOR) private readonly orchestrator: AiOrchestrator | null,
    private readonly crypto: EncryptionService,
  ) {}

  get enabled(): boolean {
    return this.client !== null && this.orchestrator !== null;
  }

  async respond(tenantId: string, conversationId: string): Promise<ReplyResult> {
    if (!this.client || !this.orchestrator) return 'skipped';
    const claimedAt = new Date();
    const turn = await this.claim(tenantId, conversationId, claimedAt);
    if (!turn) return 'nothing_to_answer';

    let outcome: TurnOutcome;
    try {
      outcome = await this.orchestrator.runTurn({
        ctx: {
          tenantId,
          conversationId,
          contactId: turn.contactId,
          assignedAgentPermissions: turn.ceiling,
          // Viewings are never auto-confirmed until the agent calendar is connected.
          viewingAutoConfirm: false,
        },
        agencyName: turn.agencyName,
        languageHint: ARABIC.test(turn.newMessages.join(' ')) ? 'ar' : 'en',
        ...(turn.summary ? { summary: turn.summary } : {}),
        history: turn.history,
        newClientMessages: turn.newMessages,
      });
    } catch (e) {
      // The orchestrator handles provider errors itself; anything here is unexpected.
      this.log.error({ err: (e as Error).message, conversationId }, 'AI turn failed');
      await withTenant(this.prisma, { tenantId }, (tx) =>
        tx.conversation.update({ where: { id: conversationId }, data: { mode: 'human' } }),
      );
      return 'failed';
    }

    const sent = await this.send(tenantId, conversationId, claimedAt, outcome.text);
    if (!sent) return 'not_sent';
    return outcome.kind === 'handover' || outcome.handover ? 'handover' : 'replied';
  }

  /**
   * Takes the conversation's unanswered client messages under a row lock, so two deliveries
   * arriving together produce one AI turn, and loads what the turn needs.
   */
  private claim(tenantId: string, conversationId: string, now: Date) {
    return withTenant(this.prisma, { tenantId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM conversation WHERE id = ${conversationId}::uuid FOR UPDATE`;
      const conv = await tx.conversation.findUnique({
        where: { id: conversationId },
        select: {
          mode: true,
          contactId: true,
          summary: true,
          lastInboundAt: true,
          account: { select: { status: true, tokenExpiresAt: true } },
          assignee: { select: { role: true, status: true } },
          agency: { select: { name: true, status: true } },
        },
      });
      if (!conv || conv.mode !== 'ai' || conv.account.status !== 'active') return null;
      if (conv.account.tokenExpiresAt && conv.account.tokenExpiresAt <= now) return null;
      if (conv.agency.status !== 'active') return null;
      // The owner's monthly AI-replies cap is reached: a person takes over.
      if (await BillingService.aiRepliesBlocked(tx, tenantId, now)) {
        await tx.conversation.update({ where: { id: conversationId }, data: { mode: 'human' } });
        return null;
      }
      if (!(await mayContact(tx, conv.contactId, 'whatsapp', 'service'))) return null;
      const decision = checkOutboundSend({
        kind: 'text',
        lastInboundAt: conv.lastInboundAt,
        optedOut: false,
        now,
      });
      if (!decision.allowed) return null;

      const pending = await tx.message.findMany({
        where: {
          conversationId,
          direction: 'inbound',
          aiClaimedAt: null,
          createdAt: { gte: new Date(now.getTime() - MAX_UNANSWERED_AGE_MS) },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 10,
        select: { id: true, body: true, type: true, createdAt: true },
      });
      if (pending.length === 0) return null;
      await tx.message.updateMany({
        where: { id: { in: pending.map((m) => m.id) } },
        data: { aiClaimedAt: now },
      });

      const earlier = await tx.message.findMany({
        where: { conversationId, createdAt: { lt: pending[0]!.createdAt }, body: { not: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_MESSAGES,
        select: { author: true, body: true },
      });
      const history = earlier
        .reverse()
        .filter((m) => m.author !== 'system')
        .map((m) => ({ role: m.author as 'client' | 'agent' | 'ai', text: m.body! }));

      const ceiling =
        conv.assignee && conv.assignee.status === 'active'
          ? aiCeilingForRole(conv.assignee.role)
          : null;
      return {
        contactId: conv.contactId,
        agencyName: conv.agency.name,
        summary: conv.summary,
        history,
        // Media without a caption: tell the model what arrived, not its content.
        newMessages: pending.map((m) => m.body ?? `[${m.type} message]`),
        ceiling,
      };
    });
  }

  /** Re-checks every gate right before sending; the AI never answers over an agent. */
  private async send(tenantId: string, conversationId: string, claimedAt: Date, text: string) {
    const prepared = await withTenant(this.prisma, { tenantId }, async (tx) => {
      const conv = await tx.conversation.findUniqueOrThrow({
        where: { id: conversationId },
        select: {
          contactId: true,
          lastInboundAt: true,
          contact: { select: { phoneE164: true } },
          account: {
            select: { id: true, status: true, phoneNumberId: true, accessTokenEnc: true },
          },
        },
      });
      const agentReplied = await tx.message.count({
        where: { conversationId, author: 'agent', createdAt: { gte: claimedAt } },
      });
      if (agentReplied > 0 || conv.account.status !== 'active' || !conv.contact.phoneE164) {
        return null;
      }
      const consent = await mayContact(tx, conv.contactId, 'whatsapp', 'service');
      const decision = checkOutboundSend({
        kind: 'text',
        lastInboundAt: conv.lastInboundAt,
        optedOut: !consent,
        now: new Date(),
      });
      if (!decision.allowed) return null;
      return {
        to: conv.contact.phoneE164.replace(/^\+/, ''),
        creds: {
          phoneNumberId: conv.account.phoneNumberId,
          accessToken: this.crypto.decrypt(conv.account.accessTokenEnc, tokenAad(conv.account.id)),
        },
      };
    });
    if (!prepared) return false;

    const body = text.slice(0, MAX_TEXT_LENGTH);
    const result = await this.client!.send(prepared.creds, { type: 'text', to: prepared.to, body });
    if (!result.ok) {
      this.log.warn(
        { conversationId, code: result.providerCode, reason: result.providerMessage },
        'WhatsApp AI reply was not accepted by Meta',
      );
    }
    await withTenant(this.prisma, { tenantId }, async (tx) => {
      await tx.message.create({
        data: {
          tenantId,
          conversationId,
          direction: 'outbound',
          author: 'ai',
          wamid: result.ok ? result.wamid : null,
          type: 'text',
          body,
          status: result.ok ? 'sent' : 'failed',
          ...(result.ok || result.providerCode === undefined
            ? {}
            : { errorCode: result.providerCode }),
        },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          // A failed send needs a person: never leave the client without an answer.
          ...(result.ok ? {} : { mode: 'human' as const }),
        },
      });
    });
    if (!result.ok) this.log.warn({ code: result.code, conversationId }, 'AI reply not delivered');
    return result.ok;
  }
}
