import { z } from 'zod';
import { normalizePhone } from '../crm/phone';
import { REMINDER_CHANNELS, REMINDER_STAGES, SMS_MAX_LENGTH } from './reminder-templates';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const money = z.coerce.number().positive().max(10_000_000_000).multipleOf(0.01);
const phone = z
  .string()
  .trim()
  .max(40)
  .transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid phone number' });
    return n ?? '';
  });
const email = z.string().trim().toLowerCase().max(254).pipe(z.email());

export const channelSchema = z.enum(REMINDER_CHANNELS);
export const stageSchema = z.enum(REMINDER_STAGES);

/** Channels the buyer agreed to receive payment reminders on (service consent). */
const consentChannels = z.array(channelSchema).max(3).default([]);

const installmentInput = z.strictObject({
  label: z.string().trim().min(1).max(80),
  dueDate: isoDate,
  amount: money,
});

export const planCreateSchema = z
  .strictObject({
    contactId: z.uuid().optional(),
    buyer: z
      .strictObject({
        fullName: z.string().trim().min(2).max(120),
        phone: phone.optional(),
        email: email.optional(),
      })
      .optional(),
    projectName: z.string().trim().min(1).max(160),
    unitRef: z.string().trim().max(60).optional(),
    totalPrice: money,
    notes: z.string().trim().max(2000).optional(),
    installments: z.array(installmentInput).min(1).max(120),
    /** Recorded as service consent, method "Payment plan agreement". */
    reminderConsent: consentChannels,
  })
  .refine((v) => Boolean(v.contactId) !== Boolean(v.buyer), {
    message: 'Choose an existing buyer or enter a new one',
    path: ['buyer'],
  });
export type PlanCreateInput = z.infer<typeof planCreateSchema>;

export const planUpdateSchema = z.strictObject({
  projectName: z.string().trim().min(1).max(160).optional(),
  unitRef: z.string().trim().max(60).nullable().optional(),
  totalPrice: money.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  remindersPaused: z.boolean().optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});
export type PlanUpdateInput = z.infer<typeof planUpdateSchema>;

export const installmentAddSchema = installmentInput;
export type InstallmentAddInput = z.infer<typeof installmentAddSchema>;

export const installmentUpdateSchema = z.strictObject({
  label: z.string().trim().min(1).max(80).optional(),
  dueDate: isoDate.optional(),
  amount: money.optional(),
  status: z.enum(['pending', 'paid', 'waived']).optional(),
  paidNote: z.string().trim().max(500).nullable().optional(),
});
export type InstallmentUpdateInput = z.infer<typeof installmentUpdateSchema>;

export const listPlansSchema = z.strictObject({
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
  q: z.string().trim().max(100).optional(),
  contactId: z.uuid().optional(),
});
export type ListPlansQuery = z.infer<typeof listPlansSchema>;

export const ruleSchema = z.strictObject({
  id: z.uuid().optional(),
  offsetDays: z.coerce.number().int().min(-60).max(60),
  channels: z.array(channelSchema).min(1).max(3),
  active: z.boolean().default(true),
});

export const configUpdateSchema = z.strictObject({
  rules: z.array(ruleSchema).max(12).optional(),
  replyToEmail: email.nullable().optional(),
  contactPhone: z.string().trim().max(40).nullable().optional(),
  paymentInstructions: z.string().trim().max(1000).nullable().optional(),
});
export type ConfigUpdateInput = z.infer<typeof configUpdateSchema>;

export const templateUpdateSchema = z.strictObject({
  subject: z.string().max(400).default(''),
  body: z.string().min(1).max(20_000),
});
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;

export const templateParamsSchema = z.strictObject({ channel: channelSchema, stage: stageSchema });

export const previewSchema = z.strictObject({
  channel: channelSchema,
  stage: stageSchema,
  subject: z.string().max(400).optional(),
  body: z.string().max(20_000).optional(),
});
export type PreviewInput = z.infer<typeof previewSchema>;

export const logQuerySchema = z.strictObject({
  planId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export { SMS_MAX_LENGTH };
