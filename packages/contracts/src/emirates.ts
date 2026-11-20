import { z } from 'zod';

/** The seven emirates. Which ones an installation supports is configuration, not code. */
export const EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
] as const;

export const emirateSchema = z.enum(EMIRATES);
export type Emirate = z.infer<typeof emirateSchema>;

/**
 * Parses a comma-separated list such as "Dubai,Abu Dhabi" into validated emirates.
 * Throws on unknown names so a typo in configuration fails at boot, not at runtime.
 */
export function parseEmirateList(raw: string): Emirate[] {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) throw new Error('At least one emirate must be configured');
  const parsed = items.map((item) => {
    const result = emirateSchema.safeParse(item);
    if (!result.success) throw new Error(`Unknown emirate: "${item}"`);
    return result.data;
  });
  return [...new Set(parsed)];
}
