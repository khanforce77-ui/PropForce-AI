import { z } from 'zod';

export const captionPlatforms = ['instagram', 'facebook', 'linkedin', 'whatsapp_status'] as const;

export const captionCreateSchema = z.strictObject({
  propertyId: z.uuid(),
  platform: z.enum(captionPlatforms),
  language: z.enum(['en', 'ar']).default('en'),
});
export type CaptionCreateBody = z.infer<typeof captionCreateSchema>;

export const captionUpdateSchema = z
  .strictObject({
    status: z.enum(['approved', 'discarded']).optional(),
    text: z.string().trim().min(1).max(3000).optional(),
  })
  .refine((b) => b.status !== undefined || b.text !== undefined, {
    message: 'Nothing to change',
  });
export type CaptionUpdateBody = z.infer<typeof captionUpdateSchema>;

export const captionListSchema = z.strictObject({
  propertyId: z.uuid().optional(),
  status: z.enum(['draft', 'approved', 'discarded']).optional(),
});
export type CaptionListQuery = z.infer<typeof captionListSchema>;

export const attributionSchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(365).default(90),
});
export type AttributionQuery = z.infer<typeof attributionSchema>;

/** What the model must return. */
export const captionOutputSchema = z.strictObject({
  caption: z.string().min(1).max(2200),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]{1,60}$/u)).max(15),
});

export const captionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['caption', 'hashtags'],
  properties: {
    caption: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
  },
} as const;
