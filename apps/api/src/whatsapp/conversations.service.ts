import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant, type PrismaClient, type TransactionClient } from '@propforce/db';
import {
  checkOutboundSend,
  type EmbeddedSignupPort,
  type WhatsAppClient,
} from '@propforce/whatsapp';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { mayContact } from '../crm/consent';
import { PRISMA } from '../database/database.module';
import { EncryptionService } from '../security/encryption.service';
import { hasPermission } from '../tenancy/permissions';
import { ownMembershipId, type TenantRequestContext } from '../tenancy/tenant.guard';
import { audit } from '../tenancy/tenancy.service';
import { EMBEDDED_SIGNUP, WHATSAPP_CLIENT } from './whatsapp.providers';
import type {
  ConnectAccountInput,
  ConnectDirectInput,
  ListConversationsQuery,
  ListMessagesQuery,
  SendMessageInput,
} from './whatsapp.schemas';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Conversation not found.');
const notConfigured = () =>
  new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'WhatsApp is not configured yet.');

export const tokenAad = (accountId: string) => `whatsapp_account:${accountId}`;

@Injectable()
export class ConversationsService {
  private readonly log = new Logger(ConversationsService.name);
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(WHATSAPP_CLIENT) private readonly client: WhatsAppClient | null,
    @Inject(EMBEDDED_SIGNUP) private readonly signup: EmbeddedSignupPort | null,
    private readonly crypto: EncryptionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private run<T>(ctx: TenantRequestContext, fn: (tx: TransactionClient) => Promise<T>) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, fn);
  }

  /** Agents see conversations assigned to them or with contacts they own; managers see all. */
  private scope(ctx: TenantRequestContext): Prisma.ConversationWhereInput {
    if (hasPermission(ctx.role, 'crm:manage')) return {};
    return {
      OR: [
        { assignedMembershipId: ownMembershipId(ctx) },
        { contact: { ownerMembershipId: ownMembershipId(ctx) } },
      ],
    };
  }

  /**
   * The number's two-step verification PIN. Derived from our encryption key so it is secret,
   * stable across reconnects, and needs no extra storage.
   */
  private phonePin(phoneNumberId: string): string {
    const digest = Buffer.from(this.crypto.hmac(`whatsapp-pin:${phoneNumberId}`), 'base64url');
    return String(digest.readUInt32BE(0) % 1_000_000).padStart(6, '0');
  }

  // ───── accounts ─────

  listAccounts(ctx: TenantRequestContext) {
    return this.run(ctx, (tx) =>
      tx.whatsAppAccount.findMany({
        where: { tenantId: ctx.tenantId },
        select: {
          id: true,
          wabaId: true,
          phoneNumberId: true,
          displayPhoneNumber: true,
          status: true,
          tokenExpiresAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Connects a number, or reconnects one this agency already has (a fresh token, e.g. before the
   * old one expires). A number connected by another agency stays theirs.
   */
  async connectAccount(ctx: TenantRequestContext, input: ConnectAccountInput) {
    if (!this.signup) throw notConfigured();
    let token: string;
    let display: string;
    let expiresAt: Date | null;
    try {
      const exchanged = await this.signup.exchangeCode(input.code);
      token = exchanged.accessToken;
      await this.signup.subscribeApp(input.wabaId, token);
      // Without registration the number cannot receive messages. Not fatal: a number that is
      // already registered (e.g. on reconnect) can refuse a second registration.
      await this.signup
        .registerPhone(input.phoneNumberId, token, this.phonePin(input.phoneNumberId))
        .catch((e: unknown) => {
          this.log.warn({ err: (e as Error).message }, 'WhatsApp phone registration failed');
        });
      display =
        input.displayPhoneNumber ??
        (await this.signup.getDisplayPhoneNumber(input.phoneNumberId, token));
      expiresAt = await this.signup.tokenExpiry(token).catch((e: unknown) => {
        // Not fatal: fall back to the exchange's expiry, else assume Meta's 60-day default.
        this.log.warn({ err: (e as Error).message }, 'WhatsApp token expiry lookup failed');
        return exchanged.expiresAt ?? new Date(Date.now() + 60 * 86_400_000);
      });
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'WhatsApp Embedded Signup failed');
      throw new AppError(
        502,
        'INTEGRATION_FAILED',
        'Meta did not accept the connection. Try again.',
      );
    }
    return this.saveAccount(ctx, {
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      display,
      token,
      expiresAt,
    });
  }

  /**
   * Attaches a number of the business that owns the Meta app, using that business's system user
   * token (it never expires). Embedded Signup cannot onboard the app owner's own business.
   */
  async connectDirect(ctx: TenantRequestContext, input: ConnectDirectInput) {
    const token = this.config.whatsapp.systemUserToken;
    if (!this.signup || !token) throw notConfigured();
    let display: string;
    try {
      await this.signup.subscribeApp(input.wabaId, token);
      await this.signup
        .registerPhone(input.phoneNumberId, token, this.phonePin(input.phoneNumberId))
        .catch((e: unknown) => {
          this.log.warn({ err: (e as Error).message }, 'WhatsApp phone registration failed');
        });
      display = await this.signup.getDisplayPhoneNumber(input.phoneNumberId, token);
    } catch (e) {
      this.log.warn({ err: (e as Error).message }, 'WhatsApp direct connect failed');
      throw new AppError(
        502,
        'INTEGRATION_FAILED',
        'Meta did not accept the connection. Check the WhatsApp account and phone number ids.',
      );
    }
    return this.saveAccount(ctx, { ...input, display, token, expiresAt: null });
  }

  private saveAccount(
    ctx: TenantRequestContext,
    input: {
      wabaId: string;
      phoneNumberId: string;
      display: string;
      token: string;
      expiresAt: Date | null;
    },
  ) {
    const { display, token, expiresAt } = input;
    return this.run(ctx, async (tx) => {
      const existing = await tx.whatsAppAccount.findFirst({
        where: { tenantId: ctx.tenantId, phoneNumberId: input.phoneNumberId },
        select: { id: true },
      });
      const select = {
        id: true,
        phoneNumberId: true,
        displayPhoneNumber: true,
        status: true,
        tokenExpiresAt: true,
      } as const;
      if (existing) {
        const account = await tx.whatsAppAccount.update({
          where: { id: existing.id },
          data: {
            wabaId: input.wabaId,
            displayPhoneNumber: display,
            accessTokenEnc: new Uint8Array(this.crypto.encrypt(token, tokenAad(existing.id))),
            tokenExpiresAt: expiresAt,
            status: 'active',
          },
          select,
        });
        await audit(tx, ctx, {
          action: 'whatsapp.reconnected',
          entityType: 'whatsapp_account',
          entityId: account.id,
          after: {
            phoneNumberId: input.phoneNumberId,
            tokenExpiresAt: expiresAt?.toISOString() ?? null,
          },
        });
        return account;
      }
      const id = randomUUID();
      const account = await tx.whatsAppAccount
        .create({
          data: {
            id,
            tenantId: ctx.tenantId,
            wabaId: input.wabaId,
            phoneNumberId: input.phoneNumberId,
            displayPhoneNumber: display,
            accessTokenEnc: new Uint8Array(this.crypto.encrypt(token, tokenAad(id))),
            tokenExpiresAt: expiresAt,
            connectedBy: ctx.userId,
          },
          select,
        })
        .catch((e: unknown) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new AppError(409, 'CONFLICT_DUPLICATE', 'This number is already connected.');
          }
          throw e;
        });
      await audit(tx, ctx, {
        action: 'whatsapp.connected',
        entityType: 'whatsapp_account',
        entityId: account.id,
        after: { phoneNumberId: input.phoneNumberId, displayPhoneNumber: display },
      });
      return account;
    });
  }

  disconnectAccount(ctx: TenantRequestContext, id: string) {
    return this.run(ctx, async (tx) => {
      const r = await tx.whatsAppAccount.updateMany({
        where: { id, tenantId: ctx.tenantId, status: 'active' },
        data: { status: 'disconnected' },
      });
      if (r.count === 0) throw new AppError(404, 'NOT_FOUND', 'WhatsApp number not found.');
      await audit(tx, ctx, {
        action: 'whatsapp.disconnected',
        entityType: 'whatsapp_account',
        entityId: id,
      });
    });
  }

  // ───── inbox ─────

  list(ctx: TenantRequestContext, q: ListConversationsQuery) {
    return this.run(ctx, async (tx) => {
      const rows = await tx.conversation.findMany({
        where: {
          AND: [
            { tenantId: ctx.tenantId },
            this.scope(ctx),
            q.mode ? { mode: q.mode } : {},
            q.mine && ctx.membershipId ? { assignedMembershipId: ctx.membershipId } : {},
            q.unread ? { unreadCount: { gt: 0 } } : {},
          ],
        },
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          mode: true,
          unreadCount: true,
          lastInboundAt: true,
          lastMessageAt: true,
          assignedMembershipId: true,
          contact: { select: { id: true, fullName: true, phoneE164: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, type: true, direction: true, author: true, createdAt: true },
          },
        },
      });
      const page = rows.slice(0, q.limit);
      return {
        data: page.map(({ messages, ...c }) => ({ ...c, lastMessage: messages[0] ?? null })),
        nextCursor: rows.length > q.limit ? page.at(-1)!.id : null,
      };
    });
  }

  private async load(tx: TransactionClient, ctx: TenantRequestContext, id: string) {
    const conv = await tx.conversation.findFirst({
      where: { AND: [{ id, tenantId: ctx.tenantId }, this.scope(ctx)] },
    });
    if (!conv) throw notFound();
    return conv;
  }

  messages(ctx: TenantRequestContext, id: string, q: ListMessagesQuery) {
    return this.run(ctx, async (tx) => {
      await this.load(tx, ctx, id);
      const rows = await tx.message.findMany({
        where: { conversationId: id, tenantId: ctx.tenantId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit,
        ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
        select: {
          id: true,
          direction: true,
          author: true,
          type: true,
          body: true,
          mediaMimeType: true,
          status: true,
          errorCode: true,
          createdAt: true,
        },
      });
      await tx.conversation.update({ where: { id }, data: { unreadCount: 0 } });
      return { data: rows.reverse() };
    });
  }

  setMode(ctx: TenantRequestContext, id: string, mode: 'ai' | 'human') {
    return this.run(ctx, async (tx) => {
      const conv = await this.load(tx, ctx, id);
      if (mode === 'ai' && !(await mayContact(tx, conv.contactId, 'whatsapp', 'service'))) {
        throw new AppError(422, 'CONSENT_MISSING', 'This client has opted out of WhatsApp.');
      }
      await tx.conversation.update({ where: { id }, data: { mode } });
      await audit(tx, ctx, {
        action: mode === 'human' ? 'conversation.takeover' : 'conversation.released_to_ai',
        entityType: 'conversation',
        entityId: id,
      });
      return { id, mode };
    });
  }

  /**
   * Agent reply. Fail-closed checks (consent, 24-hour window) run before anything is sent, and an
   * agent reply takes the conversation over from the AI.
   */
  async send(ctx: TenantRequestContext, id: string, input: SendMessageInput) {
    if (!this.client) throw notConfigured();
    const prepared = await this.run(ctx, async (tx) => {
      const conv = await this.load(tx, ctx, id);
      const [contact, account] = await Promise.all([
        tx.contact.findUniqueOrThrow({
          where: { id: conv.contactId },
          select: { phoneE164: true },
        }),
        tx.whatsAppAccount.findUniqueOrThrow({ where: { id: conv.whatsappAccountId } }),
      ]);
      if (account.status !== 'active') {
        throw new AppError(
          409,
          'INTEGRATION_DISCONNECTED',
          'This WhatsApp number is disconnected.',
        );
      }
      if (account.tokenExpiresAt && account.tokenExpiresAt <= new Date()) {
        throw new AppError(
          409,
          'INTEGRATION_EXPIRED',
          'The WhatsApp connection has expired. An owner or admin must reconnect it in Settings.',
        );
      }
      const consent = await mayContact(tx, conv.contactId, 'whatsapp', 'service');
      const decision = checkOutboundSend({
        kind: 'text',
        lastInboundAt: conv.lastInboundAt,
        optedOut: !consent,
        now: new Date(),
      });
      if (!decision.allowed) {
        throw decision.code === 'OPTED_OUT'
          ? new AppError(422, 'CONSENT_MISSING', 'This client has not agreed to WhatsApp messages.')
          : new AppError(
              422,
              'WA_WINDOW_CLOSED',
              'More than 24 hours since the client last wrote. Use an approved template.',
            );
      }
      if (conv.mode !== 'human') {
        await tx.conversation.update({ where: { id }, data: { mode: 'human' } });
      }
      return {
        to: contact.phoneE164!.replace(/^\+/, ''),
        creds: {
          phoneNumberId: account.phoneNumberId,
          accessToken: this.crypto.decrypt(account.accessTokenEnc, tokenAad(account.id)),
        },
      };
    });

    // Network call outside the transaction so a slow provider does not hold a DB connection.
    const result = await this.client.send(prepared.creds, {
      type: 'text',
      to: prepared.to,
      body: input.body,
    });

    return this.run(ctx, async (tx) => {
      const message = await tx.message.create({
        data: {
          tenantId: ctx.tenantId,
          conversationId: id,
          direction: 'outbound',
          author: 'agent',
          authorUserId: ctx.userId,
          wamid: result.ok ? result.wamid : null,
          type: 'text',
          body: input.body,
          status: result.ok ? 'sent' : 'failed',
          ...(result.ok || result.providerCode === undefined
            ? {}
            : { errorCode: result.providerCode }),
        },
        select: { id: true, status: true, createdAt: true },
      });
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: new Date() } });
      if (!result.ok) {
        throw new AppError(
          502,
          result.code === 'WINDOW_CLOSED' ? 'WA_WINDOW_CLOSED' : 'WHATSAPP_SEND_FAILED',
          'WhatsApp did not accept the message.',
        );
      }
      return message;
    });
  }
}
