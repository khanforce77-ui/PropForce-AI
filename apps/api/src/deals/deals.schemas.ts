import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.number().positive().max(1_000_000_000_000);
const percent = z.number().min(0).max(100);

export const dealCreateSchema = z
  .strictObject({
    type: z.enum(['sale', 'rental']),
    leadId: z.uuid().optional(),
    contactId: z.uuid().optional(),
    propertyId: z.uuid().nullable().optional(),
    agentMembershipId: z.uuid().optional(),
    stage: z.string().max(40).optional(),
    price: money,
    commissionPercent: percent.nullable().optional(),
    commissionAmount: z.number().min(0).max(1_000_000_000).nullable().optional(),
    vatPercent: percent.default(5),
    expectedCloseDate: z.iso.date().nullable().optional(),
    notes: text(4000).nullable().optional(),
  })
  .refine((d) => d.leadId || d.contactId, {
    message: 'Choose the lead or the client',
    path: ['leadId'],
  });
export type DealCreateInput = z.infer<typeof dealCreateSchema>;

export const dealUpdateSchema = z
  .strictObject({
    price: money.optional(),
    commissionPercent: percent.nullable().optional(),
    commissionAmount: z.number().min(0).max(1_000_000_000).nullable().optional(),
    vatPercent: percent.optional(),
    agentMembershipId: z.uuid().optional(),
    expectedCloseDate: z.iso.date().nullable().optional(),
    notes: text(4000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type DealUpdateInput = z.infer<typeof dealUpdateSchema>;

export const dealStageSchema = z
  .strictObject({ stage: z.string().max(40), reason: text(500).nullable().optional() })
  .refine((s) => s.stage !== 'fallen_through' || !!s.reason, {
    message: 'Say why the deal fell through',
    path: ['reason'],
  });
export type DealStageInput = z.infer<typeof dealStageSchema>;

export const splitsSchema = z
  .strictObject({
    splits: z
      .array(
        z
          .strictObject({
            membershipId: z.uuid().nullable().optional(),
            partyName: text(120).nullable().optional(),
            percent: z.number().gt(0).max(100),
          })
          .refine((s) => !!s.membershipId !== !!s.partyName, {
            message: 'Each split is either a team member or an outside party',
          }),
      )
      .max(10),
  })
  .refine((v) => v.splits.reduce((a, s) => a + s.percent, 0) <= 100.0001, {
    message: 'Splits add up to more than 100%',
    path: ['splits'],
  });
export type SplitsInput = z.infer<typeof splitsSchema>;

export const commissionStatusSchema = z.strictObject({
  status: z.enum(['pending', 'invoiced', 'received']),
  invoiceNumber: text(60).nullable().optional(),
});
export type CommissionStatusInput = z.infer<typeof commissionStatusSchema>;

export const taskCreateSchema = z.strictObject({
  title: text(200),
  dueDate: z.iso.date().nullable().optional(),
});
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;

export const taskUpdateSchema = z
  .strictObject({
    title: text(200).optional(),
    dueDate: z.iso.date().nullable().optional(),
    done: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type TaskUpdateInput = z.infer<typeof taskUpdateSchema>;

export const listDealsSchema = z.object({
  type: z.enum(['sale', 'rental']).optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(80).optional(),
});
export type ListDealsQuery = z.infer<typeof listDealsSchema>;

export const summarySchema = z.object({ type: z.enum(['sale', 'rental']).default('sale') });

export const revenueSchema = z.object({
  months: z.coerce.number().int().min(1).max(24).default(12),
});
