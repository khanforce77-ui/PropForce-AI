import { z } from 'zod';

const planCode = z.string().regex(/^[a-z][a-z0-9_]{1,30}$/);
const limit = z.number().int().min(0).max(10_000_000).nullable();

export const checkoutSchema = z.strictObject({ planCode });

export const capsSchema = z.strictObject({
  caps: z
    .array(
      z.strictObject({
        meter: z.enum(['ai_replies', 'whatsapp_messages']),
        /** Null removes the cap. */
        monthlyLimit: z.number().int().min(0).max(10_000_000).nullable(),
        action: z.enum(['warn', 'block']).default('warn'),
      }),
    )
    .max(2),
});
export type CapsBody = z.infer<typeof capsSchema>;

export const planUpdateSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  priceMonthlyAed: z.number().min(0).max(10_000_000).nullable().optional(),
  seatLimit: limit.optional(),
  listingLimit: limit.optional(),
  aiRepliesMonthly: limit.optional(),
  whatsappNumbers: limit.optional(),
  storageGb: limit.optional(),
  leadBooster: z.boolean().optional(),
  voice: z.enum(['none', 'inbound', 'inbound_outbound']).optional(),
  active: z.boolean().optional(),
});
export type PlanUpdateBody = z.infer<typeof planUpdateSchema>;

export const subscriptionSetSchema = z.strictObject({
  planCode,
  status: z.enum(['trialing', 'active', 'past_due', 'cancelled']),
  trialEndsAt: z.iso.datetime({ offset: true }).nullable().optional(),
  currentPeriodEnd: z.iso.datetime({ offset: true }).nullable().optional(),
  /** Copy the plan's seat and listing limits onto the agency (default yes). */
  applyLimits: z.boolean().default(true),
});
export type SubscriptionSetBody = z.infer<typeof subscriptionSetSchema>;
