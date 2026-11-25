import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const duration = z.number().int().min(15).max(240);

export const viewingStatuses = [
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'no_show',
] as const;

export const viewingCreateSchema = z.strictObject({
  leadId: z.uuid(),
  propertyId: z.uuid(),
  /** Defaults to the lead's agent, then the person booking. */
  agentMembershipId: z.uuid().optional(),
  startsAt: z.iso.datetime({ offset: true }),
  durationMinutes: duration.default(30),
  /** "requested" keeps the time on hold until the client confirms. */
  status: z.enum(['requested', 'confirmed']).default('confirmed'),
  notes: text(2000).nullable().optional(),
});
export type ViewingCreateInput = z.infer<typeof viewingCreateSchema>;

export const viewingUpdateSchema = z
  .strictObject({
    startsAt: z.iso.datetime({ offset: true }).optional(),
    durationMinutes: duration.optional(),
    agentMembershipId: z.uuid().optional(),
    notes: text(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type ViewingUpdateInput = z.infer<typeof viewingUpdateSchema>;

export const viewingStatusSchema = z
  .strictObject({
    status: z.enum(['confirmed', 'completed', 'cancelled', 'no_show']),
    outcome: text(2000).nullable().optional(),
  })
  .refine((v) => v.status !== 'cancelled' || !!v.outcome, {
    message: 'Say why the viewing was cancelled',
    path: ['outcome'],
  });
export type ViewingStatusInput = z.infer<typeof viewingStatusSchema>;

export const listViewingsSchema = z
  .object({
    from: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    to: z.iso.datetime({ offset: true }).transform((v) => new Date(v)),
    agentMembershipId: z.uuid().optional(),
    leadId: z.uuid().optional(),
    status: z.enum(viewingStatuses).optional(),
  })
  .refine((q) => q.to > q.from && q.to.getTime() - q.from.getTime() <= 62 * 86_400_000, {
    message: 'Ask for at most 62 days at a time',
    path: ['to'],
  });
export type ListViewingsQuery = z.infer<typeof listViewingsSchema>;

export const availabilitySchema = z.object({
  /** UAE calendar day, YYYY-MM-DD. */
  date: z.iso.date(),
  agentMembershipId: z.uuid().optional(),
  durationMinutes: z.coerce.number().int().min(15).max(240).default(30),
});
export type AvailabilityQuery = z.infer<typeof availabilitySchema>;
