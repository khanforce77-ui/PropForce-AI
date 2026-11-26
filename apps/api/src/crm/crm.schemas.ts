import { emirateSchema } from '@propforce/contracts';
import { z } from 'zod';
import { propertyTypes } from '../inventory/inventory.schemas';
import { normalizePhone } from './phone';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const money = z.number().min(0).max(1_000_000_000_000);

export const contactSources = [
  'manual',
  'import',
  'whatsapp',
  'portal',
  'referral',
  'website',
  'walk_in',
  'other',
] as const;
export const consentChannels = ['whatsapp', 'sms', 'email', 'phone_call'] as const;
export const consentPurposes = ['service', 'marketing'] as const;
export const leadIntents = ['buy', 'rent', 'sell', 'let'] as const;
export const leadStages = [
  'new',
  'contacted',
  'qualified',
  'viewing',
  'negotiating',
  'won',
  'lost',
] as const;

const phone = z
  .string()
  .trim()
  .max(32)
  .transform((v, ctx) => {
    const normalized = normalizePhone(v);
    if (!normalized) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid phone number, e.g. +971 50 123 4567',
      });
      return z.NEVER;
    }
    return normalized;
  });

const consentGrant = z.strictObject({
  channel: z.enum(consentChannels),
  purpose: z.enum(consentPurposes),
  method: text(120),
  evidence: optionalText(500),
});

const contactFields = {
  fullName: text(120),
  phone: phone.nullable().optional(),
  email: z.email().max(254).nullable().optional(),
  nationality: optionalText(60),
  preferredLanguage: optionalText(30),
  source: z.enum(contactSources).optional(),
  ownerMembershipId: z.uuid().nullable().optional(),
  tags: z.array(text(40)).max(20).optional(),
  notes: optionalText(4000),
  doNotContact: z.boolean().optional(),
};

export const contactCreateSchema = z
  .strictObject({
    ...contactFields,
    /** Consent given while the contact was being added (e.g. ticked on a form, said on a call). */
    consents: z.array(consentGrant).max(8).optional(),
  })
  .refine((c) => c.phone || c.email, {
    message: 'Add a phone number or an email',
    path: ['phone'],
  });
export type ContactCreateInput = z.infer<typeof contactCreateSchema>;

/** Most people one paste may add; larger lists go through CSV import. */
export const MAX_BULK_CONTACTS = 500;

export const contactBulkSchema = z.strictObject({
  /** One person per line: "number", "name, number" or "number, name". */
  lines: z.array(z.string().max(200)).min(1).max(MAX_BULK_CONTACTS),
  tag: optionalText(40),
  /**
   * The agency confirms these people agreed to be contacted. Recorded per contact, with the
   * person who confirmed it; never overrides a withdrawal or "do not contact".
   */
  consent: z
    .strictObject({
      channels: z
        .array(z.enum(['phone_call', 'whatsapp']))
        .min(1)
        .max(2),
      purpose: z.enum(consentPurposes),
      method: text(120),
    })
    .optional(),
});
export type ContactBulkInput = z.infer<typeof contactBulkSchema>;

/** Splits a pasted line into a phone number and an optional name. */
export function parseBulkLine(line: string): { phone: string; name: string | null } | null {
  const parts = line
    .split(/[,;\t|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const at = parts.findIndex((p) => normalizePhone(p) !== null);
  if (at === -1) {
    // "Sara 0501234567": the number may follow the name without a comma.
    const m = /^(.*?)(\+?[\d][\d\s().-]{6,})$/.exec(line.trim());
    const phone = m ? normalizePhone(m[2]!) : null;
    if (!m || !phone) return null;
    return { phone, name: m[1]!.trim().replace(/[-:]$/, '').trim() || null };
  }
  const name = parts
    .filter((_, i) => i !== at)
    .join(' ')
    .slice(0, 120);
  return { phone: normalizePhone(parts[at]!)!, name: name || null };
}

export const contactUpdateSchema = z.strictObject({
  fullName: contactFields.fullName.optional(),
  phone: contactFields.phone,
  email: contactFields.email,
  nationality: contactFields.nationality,
  preferredLanguage: contactFields.preferredLanguage,
  source: contactFields.source,
  ownerMembershipId: contactFields.ownerMembershipId,
  tags: contactFields.tags,
  notes: contactFields.notes,
  doNotContact: contactFields.doNotContact,
});
export type ContactUpdateInput = z.infer<typeof contactUpdateSchema>;

export const consentSchema = z.strictObject({
  channel: z.enum(consentChannels),
  purpose: z.enum(consentPurposes),
  status: z.enum(['granted', 'withdrawn']),
  method: text(120),
  evidence: optionalText(500),
});
export type ConsentInput = z.infer<typeof consentSchema>;

const pageQuery = {
  q: z.string().trim().min(1).max(80).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
};

export const listContactsSchema = z.object(pageQuery);
export type ListContactsQuery = z.infer<typeof listContactsSchema>;

export const listLeadsSchema = z.object({
  ...pageQuery,
  stage: z.enum(leadStages).optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListLeadsQuery = z.infer<typeof listLeadsSchema>;

const leadPreferences = {
  emirate: emirateSchema.nullable().optional(),
  communities: z.array(text(120)).max(20).optional(),
  propertyTypes: z.array(z.enum(propertyTypes)).max(9).optional(),
  bedroomsMin: z.number().int().min(0).max(50).nullable().optional(),
  bedroomsMax: z.number().int().min(0).max(50).nullable().optional(),
  budgetMin: money.nullable().optional(),
  budgetMax: money.nullable().optional(),
  nextFollowUpAt: z.iso.datetime({ offset: true }).nullable().optional(),
};

const rangesOk = (l: {
  bedroomsMin?: number | null;
  bedroomsMax?: number | null;
  budgetMin?: number | null;
  budgetMax?: number | null;
}) =>
  (l.bedroomsMin == null || l.bedroomsMax == null || l.bedroomsMin <= l.bedroomsMax) &&
  (l.budgetMin == null || l.budgetMax == null || l.budgetMin <= l.budgetMax);
const rangeMessage = { message: 'Minimum must not be above maximum', path: ['budgetMin'] };

export const leadCreateSchema = z
  .strictObject({
    contactId: z.uuid(),
    intent: z.enum(leadIntents),
    source: z.enum(contactSources).optional(),
    propertyId: z.uuid().nullable().optional(),
    assignedMembershipId: z.uuid().nullable().optional(),
    note: optionalText(4000),
    ...leadPreferences,
  })
  .refine(rangesOk, rangeMessage);
export type LeadCreateInput = z.infer<typeof leadCreateSchema>;

export const leadUpdateSchema = z
  .strictObject({ intent: z.enum(leadIntents).optional(), ...leadPreferences })
  .refine(rangesOk, rangeMessage);
export type LeadUpdateInput = z.infer<typeof leadUpdateSchema>;

export const leadStageSchema = z
  .strictObject({ stage: z.enum(leadStages), lostReason: optionalText(500) })
  .refine((s) => s.stage !== 'lost' || !!s.lostReason, {
    message: 'Say why the lead was lost',
    path: ['lostReason'],
  });
export type LeadStageInput = z.infer<typeof leadStageSchema>;

export const leadAssignSchema = z.strictObject({ membershipId: z.uuid().nullable() });
export const leadNoteSchema = z.strictObject({ body: text(4000) });
