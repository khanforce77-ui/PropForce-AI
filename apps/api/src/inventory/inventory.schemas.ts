import { emirateSchema } from '@propforce/contracts';
import { Prisma } from '@propforce/db';
import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).nullable().optional();
const isoDate = z.iso.date();
const money = z.number().positive().max(1_000_000_000_000);

export const listingTypes = ['sale', 'rent'] as const;
export const propertyTypes = [
  'apartment',
  'villa',
  'townhouse',
  'penthouse',
  'office',
  'retail',
  'commercial',
  'land',
  'other',
] as const;
export const propertyStatuses = [
  'draft',
  'active',
  'under_offer',
  'sold',
  'rented',
  'archived',
] as const;

const paymentPlan = z
  .array(z.strictObject({ milestone: text(120), percent: z.number().min(0).max(100) }))
  .max(20)
  .refine((rows) => rows.reduce((sum, r) => sum + r.percent, 0) <= 100, {
    message: 'Milestones add up to more than 100%',
  });

const propertyFields = {
  reference: text(32)
    .regex(/^[A-Za-z0-9._/-]+$/, 'Letters, digits and . _ / - only')
    .optional(),
  title: optionalText(160),
  listingType: z.enum(listingTypes),
  propertyType: z.enum(propertyTypes),
  completion: z.enum(['ready', 'off_plan']).optional(),
  projectId: z.uuid().nullable().optional(),
  assignedMembershipId: z.uuid().nullable().optional(),
  emirate: emirateSchema,
  community: optionalText(120),
  subCommunity: optionalText(120),
  building: optionalText(120),
  unitNo: optionalText(32),
  bedrooms: z.number().int().min(0).max(50).nullable().optional(),
  bathrooms: z.number().int().min(0).max(50).nullable().optional(),
  areaSqft: z.number().positive().max(10_000_000).nullable().optional(),
  price: money.nullable().optional(),
  rentPeriod: z.enum(['yearly', 'monthly']).nullable().optional(),
  furnishing: z.enum(['unfurnished', 'semi_furnished', 'furnished']).nullable().optional(),
  amenities: z.array(text(60)).max(60).optional(),
  parking: z.number().int().min(0).max(100).nullable().optional(),
  floor: z.number().int().min(-10).max(300).nullable().optional(),
  view: optionalText(120),
  developer: optionalText(120),
  handoverDate: isoDate.nullable().optional(),
  paymentPlan: paymentPlan.nullable().optional(),
  serviceChargePerSqft: z.number().min(0).max(10_000).nullable().optional(),
  latitude: z.number().min(22).max(27).nullable().optional(),
  longitude: z.number().min(51).max(57).nullable().optional(),
  description: z.string().trim().max(10_000).nullable().optional(),
};

type PaymentPlan = { milestone: string; percent: number }[];

/**
 * Converts wire values to database values: YYYY-MM-DD dates become Date (DATE columns), and a
 * null payment plan becomes SQL NULL (Prisma needs DbNull for JSON columns).
 */
const withDates = <
  T extends { handoverDate?: string | null | undefined; paymentPlan?: PaymentPlan | null },
>(
  v: T,
): Omit<T, 'handoverDate' | 'paymentPlan'> & {
  handoverDate?: Date | null;
  paymentPlan?: PaymentPlan | typeof Prisma.DbNull;
} => {
  const { handoverDate, paymentPlan, ...rest } = v;
  return {
    ...rest,
    ...(handoverDate !== undefined
      ? { handoverDate: handoverDate ? new Date(handoverDate) : null }
      : {}),
    ...(paymentPlan !== undefined ? { paymentPlan: paymentPlan ?? Prisma.DbNull } : {}),
  };
};

export const propertyCreateSchema = z.strictObject(propertyFields).transform(withDates);
export const propertyUpdateSchema = z
  .strictObject(propertyFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .transform(withDates);
export type PropertyCreateInput = z.output<typeof propertyCreateSchema>;
export type PropertyUpdateInput = z.output<typeof propertyUpdateSchema>;

export const statusSchema = z.strictObject({ status: z.enum(propertyStatuses) });

/**
 * The link inside the regulator's QR code on the permit (DLD Trakheesi, ADREC). Only https links
 * on UAE government (.gov.ae) hosts are accepted; the portal draws the QR code from it.
 */
export const permitVerificationUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (v) => {
      try {
        const u = new URL(v);
        const host = u.hostname.toLowerCase();
        return (
          u.protocol === 'https:' &&
          !u.username &&
          !u.port &&
          (host === 'gov.ae' || host.endsWith('.gov.ae'))
        );
      } catch {
        return false;
      }
    },
    { message: 'Paste the https link from the permit QR code (a .gov.ae address)' },
  )
  // Matches the database check, which wants the host in lower case.
  .transform((v) => {
    const u = new URL(v);
    return `https://${u.hostname.toLowerCase()}${u.pathname}${u.search}`;
  });

/** The number is optional: an agency may upload the permit document instead (see the document route). */
export const permitSchema = z
  .strictObject({
    authority: text(32),
    /** Sale or rent, as printed on the permit. Defaults to the listing's own type. */
    purpose: z.enum(listingTypes).optional(),
    permitNumber: optionalText(64),
    validUntil: isoDate,
    verificationUrl: permitVerificationUrl.nullable().optional(),
  })
  .transform((v) => ({
    ...v,
    purpose: v.purpose ?? null,
    permitNumber: v.permitNumber ?? null,
    verificationUrl: v.verificationUrl ?? null,
    validUntil: new Date(v.validUntil),
  }));
export type PermitInput = z.output<typeof permitSchema>;

/** Renewing a permit: a new expiry date and, if it changed, a new number. */
export const permitUpdateSchema = z
  .strictObject({
    permitNumber: optionalText(64),
    purpose: z.enum(listingTypes).optional(),
    validUntil: isoDate.optional(),
    verificationUrl: permitVerificationUrl.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
  .transform((v) => ({
    ...(v.permitNumber !== undefined ? { permitNumber: v.permitNumber } : {}),
    ...(v.purpose !== undefined ? { purpose: v.purpose } : {}),
    ...(v.verificationUrl !== undefined ? { verificationUrl: v.verificationUrl } : {}),
    ...(v.validUntil ? { validUntil: new Date(v.validUntil) } : {}),
  }));
export type PermitUpdateInput = z.output<typeof permitUpdateSchema>;

export const permitDocumentQuery = z.strictObject({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // No path separators or control characters (code points below 32).
    .refine((v) => !/[\\/]/.test(v) && [...v].every((c) => c.charCodeAt(0) >= 32), {
      message: 'Invalid file name',
    }),
});

export const projectSchema = z
  .strictObject({
    name: text(160),
    developer: optionalText(120),
    emirate: emirateSchema,
    community: optionalText(120),
    handoverDate: isoDate.nullable().optional(),
    paymentPlan: paymentPlan.nullable().optional(),
  })
  .transform(withDates);
export type ProjectInput = z.output<typeof projectSchema>;

const boolParam = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listPropertiesSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  status: z.enum(propertyStatuses).optional(),
  listingType: z.enum(listingTypes).optional(),
  propertyType: z.enum(propertyTypes).optional(),
  emirate: emirateSchema.optional(),
  bedrooms: z.coerce.number().int().min(0).max(50).optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  q: z.string().trim().min(1).max(80).optional(),
  mine: boolParam,
});
export type ListPropertiesQuery = z.output<typeof listPropertiesSchema>;
