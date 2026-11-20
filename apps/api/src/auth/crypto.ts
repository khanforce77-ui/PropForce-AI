import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

// OWASP-recommended Argon2id parameters (m=19 MiB, t=2, p=1).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (password: string): Promise<string> => hash(password, ARGON2_OPTIONS);

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** A hash of a fixed dummy password, used to keep login timing similar for unknown emails. */
let dummyHash: Promise<string> | undefined;
export const getDummyHash = (): Promise<string> =>
  (dummyHash ??= hashPassword('dummy-password-for-timing'));

/** 256-bit random token, URL-safe. */
export const generateToken = (): string => randomBytes(32).toString('base64url');

/** Tokens are stored only as SHA-256 hashes (base64url, 43 chars). */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('base64url');
