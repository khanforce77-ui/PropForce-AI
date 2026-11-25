import { emirateSchema } from '@propforce/contracts';
import { z } from 'zod';
import { calculators } from './calculator';

const money = z.number().min(0).max(1_000_000_000);

export const estimateSchema = z.strictObject({
  emirate: emirateSchema,
  calculator: z.enum(calculators),
  price: money.optional(),
  annualRent: money.optional(),
  downPaymentPct: z.number().min(0).max(100).optional(),
  interestRatePct: z.number().min(0).max(25).optional(),
  years: z.number().int().min(1).max(25).optional(),
  national: z.boolean().optional(),
  brokerSplitPct: z.number().min(0).max(100).optional(),
});
export type EstimateBody = z.infer<typeof estimateSchema>;

export const rulesQuery = z.strictObject({ emirate: emirateSchema });

/** An agency's own value for a fee (overrides PropForce's sample template for that agency). */
export const ruleOverrideSchema = z
  .strictObject({
    emirate: emirateSchema,
    code: z
      .string()
      .trim()
      .regex(/^[a-z0-9_]{1,60}$/),
    ratePct: z.number().min(0).max(100).nullable(),
    amount: z.number().min(0).max(10_000_000).nullable(),
    vat: z.boolean().optional(),
    source: z.string().trim().min(3).max(500),
    /** Confirms the agency checked this value against the authority's published fee. */
    verified: z.boolean(),
  })
  .refine((v) => v.ratePct !== null || v.amount !== null, {
    message: 'Enter a percentage, an amount, or both',
  });
export type RuleOverrideInput = z.infer<typeof ruleOverrideSchema>;

const pctField = z.number().min(0).max(100);

export const roiSchema = z.strictObject({
  emirate: emirateSchema,
  price: z.number().positive().max(1_000_000_000),
  annualRent: z.number().positive().max(100_000_000),
  /** Optional link to a listing (area and service charge are read from it). */
  propertyId: z.uuid().optional(),
  areaSqft: z.number().positive().max(10_000_000).optional(),
  serviceChargePerSqft: z.number().min(0).max(1000).optional(),
  serviceChargeYearly: z.number().min(0).max(10_000_000).optional(),
  vacancyPct: pctField.default(5),
  managementPct: pctField.default(0),
  maintenanceYearly: z.number().min(0).max(10_000_000).default(0),
  appreciationPct: z.number().min(-50).max(50).default(3),
  rentGrowthPct: z.number().min(-50).max(50).default(2),
  years: z.number().int().min(1).max(30).default(10),
  mortgage: z
    .strictObject({
      downPaymentPct: pctField.optional(),
      interestRatePct: z.number().min(0).max(25).default(4.5),
      years: z.number().int().min(1).max(25).default(25),
      national: z.boolean().optional(),
    })
    .optional(),
});
export type RoiBody = z.infer<typeof roiSchema>;

export const affordabilitySchema = z.strictObject({
  monthlyIncome: z.number().positive().max(100_000_000),
  monthlyDebts: z.number().min(0).max(100_000_000).default(0),
  interestRatePct: z.number().min(0).max(25).default(4.5),
  stressRatePct: z.number().min(0).max(25).optional(),
  years: z.number().int().min(1).max(25).default(25),
  national: z.boolean().default(false),
});
export type AffordabilityBody = z.infer<typeof affordabilitySchema>;
