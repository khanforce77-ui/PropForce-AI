import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { findWhatsAppAccountForWebhook, withTenant, type PrismaClient } from '../src';
import {
  createAppClient,
  createOwnerClient,
  resetDatabase,
  seedTenant,
  type SeededTenant,
} from './helpers';

let owner: PrismaClient;
let app: PrismaClient;
let a: SeededTenant;
let b: SeededTenant;
let bAccountId: string;
let bConversationId: string;

beforeAll(() => {
  owner = createOwnerClient();
  app = createAppClient();
});
afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

beforeEach(async () => {
  await resetDatabase(owner);
  a = await seedTenant(owner, 'Alpha');
  b = await seedTenant(owner, 'Bravo');
  const account = await owner.whatsAppAccount.create({
    data: {
      tenantId: b.agencyId,
      wabaId: '2002',
      phoneNumberId: '1002',
      displayPhoneNumber: '+971 4 000 0002',
      accessTokenEnc: Buffer.from('ciphertext'),
      connectedBy: b.ownerUserId,
    },
  });
  bAccountId = account.id;
  const contact = await owner.contact.create({
    data: {
      tenantId: b.agencyId,
      fullName: 'Bravo Client',
      phoneE164: '+971501112233',
      createdBy: b.ownerUserId,
    },
  });
  const conv = await owner.conversation.create({
    data: { tenantId: b.agencyId, whatsappAccountId: account.id, contactId: contact.id },
  });
  bConversationId = conv.id;
  await owner.message.create({
    data: {
      tenantId: b.agencyId,
      conversationId: conv.id,
      direction: 'inbound',
      author: 'client',
      wamid: 'wamid.B1',
      type: 'text',
      body: 'hello',
      status: 'received',
    },
  });
});

describe('WhatsApp tables isolation', () => {
  it('another agency sees no accounts, conversations or messages', async () => {
    const seen = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      accounts: await tx.whatsAppAccount.count(),
      conversations: await tx.conversation.count(),
      messages: await tx.message.count(),
    }));
    expect(seen).toEqual({ accounts: 0, conversations: 0, messages: 0 });
  });

  it('another agency cannot write into or move rows of the owner agency', async () => {
    await withTenant(app, { tenantId: a.agencyId }, async (tx) => {
      expect(
        (await tx.message.updateMany({ where: { wamid: 'wamid.B1' }, data: { status: 'read' } }))
          .count,
      ).toBe(0);
      expect((await tx.conversation.updateMany({ data: { mode: 'human' } })).count).toBe(0);
    });
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.message.create({
          data: {
            tenantId: b.agencyId,
            conversationId: bConversationId,
            direction: 'outbound',
            author: 'agent',
            type: 'text',
            body: 'x',
            status: 'sent',
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('the application cannot delete messages', async () => {
    await expect(
      withTenant(app, { tenantId: b.agencyId }, (tx) => tx.message.deleteMany({})),
    ).rejects.toThrow();
  });

  it('webhook routing reveals only the matching account and no token', async () => {
    const found = await findWhatsAppAccountForWebhook(app, '1002');
    expect(found).toEqual({
      id: bAccountId,
      tenantId: b.agencyId,
      wabaId: '2002',
      connectedBy: b.ownerUserId,
    });
    expect(await findWhatsAppAccountForWebhook(app, '9999')).toBeNull();
    expect(await findWhatsAppAccountForWebhook(app, "1' OR '1'='1")).toBeNull();
    // Without the routing setting nothing is visible.
    expect(await app.whatsAppAccount.count()).toBe(0);
  });

  it('disconnected numbers are not routed', async () => {
    await owner.whatsAppAccount.update({
      where: { id: bAccountId },
      data: { status: 'disconnected' },
    });
    expect(await findWhatsAppAccountForWebhook(app, '1002')).toBeNull();
  });

  it('rejects inbound messages authored by anyone but the client', async () => {
    await expect(
      owner.message.create({
        data: {
          tenantId: b.agencyId,
          conversationId: bConversationId,
          direction: 'inbound',
          author: 'ai',
          type: 'text',
          status: 'received',
        },
      }),
    ).rejects.toThrow();
  });
});
