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
  /** `developer` = property developer (payment plans and payment reminders). Dubai only. */
  accountType: z.enum(['agency', 'developer']).default('agency'),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(128) });
export const emailOnlySchema = z.strictObject({ email });
export const tokenSchema = z.strictObject({ token });
export const resetPasswordSchema = z.strictObject({ token, newPassword: password });

const totpCode = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');
const recoveryCode = z.string().trim().min(10).max(20);

/** Exactly one of `code` or `recoveryCode`. */
const secondFactor = {
  code: totpCode.optional(),
  recoveryCode: recoveryCode.optional(),
};
const exactlyOneFactor = (v: { code?: string | undefined; recoveryCode?: string | undefined }) =>
  Boolean(v.code) !== Boolean(v.recoveryCode);

export const mfaLoginSchema = z
  .strictObject({ mfaToken: z.string().min(20).max(2000), ...secondFactor })
  .refine(exactlyOneFactor, { message: 'Provide either code or recoveryCode' });
export const totpConfirmSchema = z.strictObject({ code: totpCode });
export const mfaDisableSchema = z
  .strictObject({ password: z.string().min(1).max(128), ...secondFactor })
  .refine(exactlyOneFactor, { message: 'Provide either code or recoveryCode' });
