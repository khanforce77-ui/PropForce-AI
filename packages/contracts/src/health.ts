import { z } from 'zod';

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'error']),
  service: z.string(),
  version: z.string(),
  checks: z.record(z.string(), z.enum(['up', 'down', 'skipped'])).default({}),
});
export type HealthStatus = z.infer<typeof healthStatusSchema>;
