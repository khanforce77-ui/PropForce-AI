import { z } from 'zod';

export const lineCreateSchema = z.strictObject({
  providerPhoneNumberId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,100}$/, 'Paste the phone number ID from the Vapi dashboard.'),
  phoneE164: z
    .string()
    .trim()
    .regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +97142345678.')
    .optional(),
  label: z.string().trim().max(60).optional(),
  transcriptPolicy: z.enum(['summary_only', 'full_transcript']).default('summary_only'),
});
export type LineCreateBody = z.infer<typeof lineCreateSchema>;

export const lineUpdateSchema = z.strictObject({
  label: z.string().trim().max(60).nullable().optional(),
  transcriptPolicy: z.enum(['summary_only', 'full_transcript']).optional(),
  active: z.boolean().optional(),
});
export type LineUpdateBody = z.infer<typeof lineUpdateSchema>;

export const listCallsSchema = z.strictObject({
  contactId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
