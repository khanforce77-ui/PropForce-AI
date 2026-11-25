import { emirateSchema } from '@propforce/contracts';
import { z } from 'zod';
import { contactSources, leadIntents, leadStages } from '../crm/crm.schemas';

const text = (max: number) => z.string().trim().min(1).max(max);

export const audienceSchema = z.strictObject({
  tags: z.array(text(40)).max(20).optional(),
  sources: z.array(z.enum(contactSources)).max(10).optional(),
  stages: z.array(z.enum(leadStages)).max(7).optional(),
  intents: z.array(z.enum(leadIntents)).max(4).optional(),
  emirate: emirateSchema.optional(),
  communities: z.array(text(120)).max(20).optional(),
});
export type Audience = z.infer<typeof audienceSchema>;

const fields = {
  name: text(120),
  whatsappAccountId: z.uuid(),
  /** Meta template names: lowercase letters, digits and underscores. */
  templateName: z
    .string()
    .trim()
    .regex(
      /^[a-z0-9_]{1,512}$/,
      'Use the template name exactly as in Meta (e.g. new_listing_alert)',
    ),
  languageCode: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'Use a language code like en, en_US or ar'),
  bodyParams: z.array(text(1024)).max(10),
  audience: audienceSchema,
  dailyLimit: z.number().int().min(1).max(100_000),
};

export const campaignCreateSchema = z.strictObject({
  ...fields,
  languageCode: fields.languageCode.default('en'),
  bodyParams: fields.bodyParams.default([]),
  audience: fields.audience.default({}),
  dailyLimit: fields.dailyLimit.default(250),
});
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;

export const campaignUpdateSchema = z
  .strictObject(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type CampaignUpdateInput = z.infer<typeof campaignUpdateSchema>;

export const recipientsQuerySchema = z.object({
  status: z.enum(['queued', 'skipped', 'sent', 'failed', 'replied']).optional(),
});
