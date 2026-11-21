import { emirateSchema } from '@propforce/contracts';
import { z } from 'zod';
import { listingTypes, propertyTypes } from '../inventory/inventory.schemas';
import { normalizePhone } from './phone';

const queryInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const queryMoney = z.coerce.number().min(0).max(1_000_000_000_000);
const queryText = (max: number) => z.string().trim().min(1).max(max);

export const publicSorts = ['newest', 'price_asc', 'price_desc', 'handover'] as const;

/** Search on the public portal. Unknown keys are refused, like every API input. */
export const publicSearchSchema = z.strictObject({
  purpose: z.enum(listingTypes).optional(),
  emirate: emirateSchema.optional(),
  community: queryText(120).optional(),
  type: z.enum(propertyTypes).optional(),
  completion: z.enum(['ready', 'off_plan']).optional(),
  minPrice: queryMoney.optional(),
  maxPrice: queryMoney.optional(),
  /** Minimum bedrooms; 0 = studio. */
  beds: queryInt(0, 50).optional(),
  /** Minimum bathrooms. */
  baths: queryInt(1, 20).optional(),
  /** Listings that have this amenity (exact name, any case). */
  amenity: queryText(60).optional(),
  minArea: queryMoney.optional(),
  maxArea: queryMoney.optional(),
  furnished: z.enum(['unfurnished', 'semi_furnished', 'furnished']).optional(),
  q: queryText(100).optional(),
  /** One agency's listings, by its public slug. */
  agency: queryText(80).optional(),
  /** One agent's listings, by their public id. */
  agent: z.uuid().optional(),
  /** Off-plan project name (exact, any case). */
  project: queryText(120).optional(),
  /** Specific listings, e.g. a visitor's saved ones: comma-separated ids, at most 100. */
  ids: z
    .string()
    .max(100 * 37)
    .transform((v, ctx) => {
      const list = [
        ...new Set(
          v
            .split(',')
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean),
        ),
      ];
      const ok = list.length <= 100 && list.every((x) => z.uuid().safeParse(x).success);
      if (!ok) {
        ctx.addIssue({ code: 'custom', message: 'ids must be up to 100 listing ids' });
        return z.NEVER;
      }
      return list;
    })
    .optional(),
  sort: z.enum(publicSorts).default('newest'),
  page: queryInt(1, 200).default(1),
  pageSize: queryInt(1, 48).default(24),
});
export type PublicSearchQuery = z.infer<typeof publicSearchSchema>;

const phone = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const e164 = normalizePhone(value);
    if (!e164) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number, e.g. 050 123 4567' });
      return z.NEVER;
    }
    return e164;
  });

/**
 * The wording a visitor agrees to, stored with each enquiry as evidence of consent. Must match
 * the checkbox labels in apps/portal/components/enquiry-form.tsx.
 */
export const CONSENT_CONTACT_TEXT =
  'I agree that this agency may contact me by phone, WhatsApp or email about this enquiry, and that my details are shared with them for this purpose.';
export const CONSENT_MARKETING_TEXT = 'Send me similar property offers from this agency.';

export const enquirySchema = z.strictObject({
  fullName: z.string().trim().min(2).max(120),
  phone,
  email: z
    .email()
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  message: z.string().trim().min(2).max(2000),
  consentContact: z.literal(true, { message: 'Consent is required to send an enquiry' }),
  consentMarketing: z.boolean().default(false),
  /** Honeypot: hidden from people, filled in by naive bots. Must stay empty. */
  website: z.string().max(200).optional(),
  /** Milliseconds between the form appearing and being sent; bots are instant. */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
  /** Cloudflare Turnstile token; required once TURNSTILE_SECRET_KEY is set. */
  captchaToken: z.string().max(4096).optional(),
});
export type EnquiryInput = z.infer<typeof enquirySchema>;

export const reportReasons = [
  'not_available',
  'wrong_price',
  'wrong_details',
  'wrong_photos',
  'fraud',
  'other',
] as const;

/** A visitor reporting a problem with a listing. */
export const reportSchema = z.strictObject({
  reason: z.enum(reportReasons),
  details: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || undefined),
  email: z
    .email()
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  website: z.string().max(200).optional(),
  captchaToken: z.string().max(4096).optional(),
});
export type ReportInput = z.infer<typeof reportSchema>;

export const contactSchema = z.strictObject({ channel: z.enum(['whatsapp', 'call']) });

// ───── agency side ─────

const optionalPhone = z.union([phone, z.null()]).optional();

export const agentProfileSchema = z.strictObject({
  publicPhoneE164: optionalPhone,
  whatsappE164: optionalPhone,
  brn: z.string().trim().min(1).max(32).nullable().optional(),
});
export type AgentProfileInput = z.infer<typeof agentProfileSchema>;

export const enquiryStatuses = ['new', 'contacted', 'converted', 'spam', 'closed'] as const;

export const listEnquiriesSchema = z.strictObject({
  status: z.enum(enquiryStatuses).optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  page: queryInt(1, 1000).default(1),
  pageSize: queryInt(1, 100).default(25),
});
export type ListEnquiriesQuery = z.infer<typeof listEnquiriesSchema>;

export const reportStatuses = ['open', 'resolved', 'dismissed'] as const;

export const listReportsSchema = z.strictObject({
  status: z.enum(reportStatuses).optional(),
  page: queryInt(1, 1000).default(1),
  pageSize: queryInt(1, 100).default(25),
});
export type ListReportsQuery = z.infer<typeof listReportsSchema>;

export const reportStatusSchema = z.strictObject({ status: z.enum(reportStatuses) });

export const enquiryStatusSchema = z.strictObject({ status: z.enum(enquiryStatuses) });
