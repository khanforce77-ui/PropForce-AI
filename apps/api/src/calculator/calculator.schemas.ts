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
