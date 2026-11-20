import { z } from 'zod';

/** RFC 9457 Problem Details, the error shape for every API error. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  detail: z.string().optional(),
  code: z.string(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
