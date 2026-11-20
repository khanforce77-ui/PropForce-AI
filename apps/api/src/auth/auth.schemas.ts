import { EMIRATES } from '@propforce/contracts';
import { z } from 'zod';

const email = z.string().trim().toLowerCase().max(254).pipe(z.email());
// Length-based policy (NIST SP 800-63B): no composition rules, no forced rotation.
const password = z.string().min(12, 'Use at least 12 characters').max(128);
const token = z.string().min(20).max(200);

export const registerSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(120),
  email,
  password,
  agency: z.strictObject({
    name: z.string().trim().min(2).max(160),
    emirate: z.enum(EMIRATES),
  }),
  acceptTerms: z.literal(true, { message: 'Terms must be accepted' }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const emailOnlySchema = z.strictObject({ email });
export const tokenSchema = z.strictObject({ token });
export const resetPasswordSchema = z.strictObject({ token, newPassword: password });
