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
  direction: z.enum(['inbound', 'outbound']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** The first thing the AI says must tell the person they are speaking with an AI. */
const DISCLOSES_AI =
  /\b(AI|A\.I\.|artificial intelligence|virtual assistant|digital assistant)\b|ذكاء اصطناعي|مساعد (افتراضي|ذكي)/i;

const scriptFields = {
  name: z.string().trim().min(1).max(80),
  purpose: z.enum(['service', 'marketing']),
  language: z.enum(['en', 'ar']),
  firstMessage: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((s) => DISCLOSES_AI.test(s), {
      message: 'The first message must say the caller is an AI assistant (UAE disclosure rule).',
    }),
  instructions: z.string().trim().min(1).max(8000),
  questions: z.array(z.string().trim().min(1).max(200)).max(10),
  transcriptPolicy: z.enum(['summary_only', 'full_transcript']),
  active: z.boolean(),
};

export const scriptCreateSchema = z.strictObject({
  ...scriptFields,
  purpose: scriptFields.purpose.default('service'),
  language: scriptFields.language.default('en'),
  questions: scriptFields.questions.default([]),
  transcriptPolicy: scriptFields.transcriptPolicy.default('summary_only'),
  active: scriptFields.active.default(true),
});
export type ScriptCreateBody = z.infer<typeof scriptCreateSchema>;

export const scriptUpdateSchema = z.strictObject({
  name: scriptFields.name.optional(),
  purpose: scriptFields.purpose.optional(),
  language: scriptFields.language.optional(),
  firstMessage: scriptFields.firstMessage.optional(),
  instructions: scriptFields.instructions.optional(),
  questions: scriptFields.questions.optional(),
  transcriptPolicy: scriptFields.transcriptPolicy.optional(),
  active: scriptFields.active.optional(),
});
export type ScriptUpdateBody = z.infer<typeof scriptUpdateSchema>;

export const placeCallSchema = z.strictObject({
  contactId: z.uuid(),
  scriptId: z.uuid(),
  leadId: z.uuid().optional(),
  /** Book the call for later instead of ringing now (inside calling hours, up to 30 days). */
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});
export type PlaceCallBody = z.infer<typeof placeCallSchema>;

/** Most calls one bulk request books; the page sends bigger lists in parts. */
export const MAX_BULK_CALLS = 50;

export const bulkCallSchema = z.strictObject({
  scriptId: z.uuid(),
  contactIds: z.array(z.uuid()).min(1).max(MAX_BULK_CALLS),
  /** First call time; omitted means now (or the next calling-hours window). */
  startAt: z.iso.datetime({ offset: true }).optional(),
});
export type BulkCallBody = z.infer<typeof bulkCallSchema>;
