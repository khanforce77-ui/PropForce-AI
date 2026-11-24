import { z } from 'zod';

export const connectAccountSchema = z
  .object({
    /** Short-lived code from Meta's Embedded Signup popup. */
    code: z.string().trim().min(10).max(1024),
    wabaId: z.string().regex(/^\d{1,32}$/),
    phoneNumberId: z.string().regex(/^\d{1,32}$/),
    /** Optional: looked up from Meta when the signup popup did not provide it. */
    displayPhoneNumber: z.string().trim().min(5).max(32).optional(),
  })
  .strict();
export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;

/** Platform admins only: a number of the app-owning business, attached with its system token. */
export const connectDirectSchema = z
  .object({
    wabaId: z
      .string()
      .trim()
      .regex(/^\d{1,32}$/),
    phoneNumberId: z
      .string()
      .trim()
      .regex(/^\d{1,32}$/),
  })
  .strict();
export type ConnectDirectInput = z.infer<typeof connectDirectSchema>;

export const listConversationsSchema = z
  .object({
    mode: z.enum(['ai', 'human']).optional(),
    mine: z.coerce.boolean().optional(),
    unread: z.coerce.boolean().optional(),
    cursor: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ListConversationsQuery = z.infer<typeof listConversationsSchema>;

export const listMessagesSchema = z
  .object({
    before: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export type ListMessagesQuery = z.infer<typeof listMessagesSchema>;

export const sendMessageSchema = z.object({ body: z.string().trim().min(1).max(4096) }).strict();
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
