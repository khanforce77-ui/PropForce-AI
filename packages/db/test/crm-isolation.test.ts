import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type PrismaClient } from '../src';
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
let bContactId: string;
let bLeadId: string;

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
  const contact = await owner.contact.create({
    data: {
      tenantId: b.agencyId,
      fullName: 'Bravo Buyer',
      phoneE164: '+971501112233',
      createdBy: b.ownerUserId,
    },
  });
  bContactId = contact.id;
  await owner.consentRecord.create({
    data: {
      tenantId: b.agencyId,
      contactId: contact.id,
      channel: 'whatsapp',
      purpose: 'service',
      status: 'granted',
      method: 'web form',
    },
  });
  const lead = await owner.lead.create({
    data: {
      tenantId: b.agencyId,
      contactId: contact.id,
      intent: 'buy',
      createdBy: b.ownerUserId,
    },
  });
  bLeadId = lead.id;
  await owner.leadActivity.create({
    data: { tenantId: b.agencyId, leadId: lead.id, type: 'created' },
  });
});

describe('CRM tables', () => {
  it('are invisible without tenant context', async () => {
    expect(await app.contact.count()).toBe(0);
    expect(await app.consentRecord.count()).toBe(0);
    expect(await app.lead.count()).toBe(0);
    expect(await app.leadActivity.count()).toBe(0);
  });

  it('do not show another agency’s rows', async () => {
    const seen = await withTenant(app, { tenantId: a.agencyId }, async (tx) => ({
      contacts: await tx.contact.count(),
      consents: await tx.consentRecord.count(),
      leads: await tx.lead.count(),
      activity: await tx.leadActivity.count(),
    }));
    expect(seen).toEqual({ contacts: 0, consents: 0, leads: 0, activity: 0 });
  });

  it('refuse a lead that points at another agency’s contact', async () => {
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.lead.create({
          data: {
            tenantId: a.agencyId,
            contactId: bContactId,
            intent: 'rent',
            createdBy: a.ownerUserId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('keep consent history and lead timeline append-only', async () => {
    await expect(
      withTenant(app, { tenantId: b.agencyId }, (tx) =>
        tx.consentRecord.updateMany({ data: { status: 'withdrawn' } }),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withTenant(app, { tenantId: b.agencyId }, (tx) => tx.leadActivity.deleteMany({})),
    ).rejects.toThrow(/permission denied/i);
  });

  it('erasing a contact removes its leads, consent history and timeline', async () => {
    await withTenant(app, { tenantId: b.agencyId }, (tx) =>
      tx.contact.delete({ where: { id: bContactId } }),
    );
    expect(await owner.lead.count({ where: { id: bLeadId } })).toBe(0);
    expect(await owner.consentRecord.count({ where: { contactId: bContactId } })).toBe(0);
    expect(await owner.leadActivity.count({ where: { leadId: bLeadId } })).toBe(0);
  });

  it('reject malformed phone numbers, unreachable contacts and inverted budgets', async () => {
    const make = (data: { phoneE164?: string | null; email?: string | null }) =>
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.contact.create({
          data: { tenantId: a.agencyId, fullName: 'X', createdBy: a.ownerUserId, ...data },
        }),
      );
    await expect(make({ phoneE164: '0501234567' })).rejects.toThrow();
    await expect(make({})).rejects.toThrow();
    const ok = await make({ email: 'x@example.test' });
    await expect(
      withTenant(app, { tenantId: a.agencyId }, (tx) =>
        tx.lead.create({
          data: {
            tenantId: a.agencyId,
            contactId: ok.id,
            intent: 'buy',
            budgetMin: 2_000_000,
            budgetMax: 1_000_000,
            createdBy: a.ownerUserId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('keeps phone numbers unique within an agency but not across agencies', async () => {
    const make = (tenant: SeededTenant) =>
      withTenant(app, { tenantId: tenant.agencyId }, (tx) =>
        tx.contact.create({
          data: {
            tenantId: tenant.agencyId,
            fullName: 'Same Phone',
            phoneE164: '+971501112233',
            createdBy: tenant.ownerUserId,
          },
        }),
      );
    await expect(make(a)).resolves.toBeTruthy();
    await expect(make(b)).rejects.toThrow();
  });
});
