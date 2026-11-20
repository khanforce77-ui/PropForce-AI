import { createHmac } from 'node:crypto';
import type { TransactionClient } from '@propforce/db';

/**
 * Database-backed sliding-window rate limits for public endpoints. They hold across serverless
 * instances, unlike in-memory counters. Buckets contain only keyed hashes.
 */
export async function hitRateLimit(
  tx: TransactionClient,
  bucket: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const used = await tx.publicRateHit.count({ where: { bucket, createdAt: { gt: since } } });
  if (used >= limit) return false;
  await tx.publicRateHit.createMany({ data: [{ bucket }] });
  // Occasionally clear out old hits so the table stays small.
  if (Math.random() < 0.02) {
    await tx.publicRateHit.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } },
    });
  }
  return true;
}

/** Keyed hash so stored values cannot be reversed to an IP or phone number by a dictionary. */
export function keyedHash(key: Buffer, purpose: string, value: string): string {
  return createHmac('sha256', key).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
}
