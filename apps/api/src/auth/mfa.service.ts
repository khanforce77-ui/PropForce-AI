import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@propforce/db';
import { randomInt } from 'node:crypto';
import { Secret, TOTP } from 'otpauth';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import { EncryptionService } from '../security/encryption.service';
import { verifyPassword } from './crypto';

const PERIOD_SECONDS = 30;
const RECOVERY_CODE_COUNT = 10;
// Unambiguous alphabet (no 0/O, 1/I/L).
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const invalidCode = () =>
  new AppError(401, 'AUTH_MFA_INVALID', 'The code is invalid or was already used.');

export function generateRecoveryCode(): string {
  const chars = Array.from(
    { length: 10 },
    () => RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)],
  );
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

@Injectable()
export class MfaService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  private totp(secretBase32: string, label: string): TOTP {
    return new TOTP({
      issuer: 'PropForce AI',
      label,
      algorithm: 'SHA1', // what authenticator apps support universally
      digits: 6,
      period: PERIOD_SECONDS,
      secret: Secret.fromBase32(secretBase32),
    });
  }

  private aad(userId: string): string {
    return `mfa_factor:totp:${userId}`;
  }

  async isEnabled(userId: string): Promise<boolean> {
    return (
      (await this.prisma.mfaFactor.count({
        where: { userId, type: 'totp', verifiedAt: { not: null } },
      })) > 0
    );
  }

  /** Starts enrolment. Replaces any unconfirmed attempt; refuses if MFA is already on. */
  async beginTotpSetup(userId: string): Promise<{ secret: string; otpauthUri: string }> {
    if (await this.isEnabled(userId)) {
      throw new AppError(
        409,
        'AUTH_MFA_ALREADY_ENABLED',
        'Two-factor authentication is already on.',
      );
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const secret = new Secret({ size: 20 }).base32;
    await this.prisma.$transaction([
      this.prisma.mfaFactor.deleteMany({ where: { userId, type: 'totp', verifiedAt: null } }),
      this.prisma.mfaFactor.create({
        data: {
          userId,
          type: 'totp',
          secretEncrypted: new Uint8Array(this.encryption.encrypt(secret, this.aad(userId))),
        },
      }),
    ]);
    return { secret, otpauthUri: this.totp(secret, user.email).toString() };
  }

  /** Confirms enrolment with a first code and returns recovery codes (shown once). */
  async confirmTotpSetup(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const factor = await this.prisma.mfaFactor.findFirst({
      where: { userId, type: 'totp', verifiedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!factor) throw new AppError(400, 'AUTH_MFA_NOT_STARTED', 'Start two-factor setup first.');
    const step = this.matchStep(factor, userId, code);
    if (step === null) throw invalidCode();

    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await this.prisma.$transaction([
      this.prisma.mfaFactor.update({
        where: { id: factor.id },
        data: { verifiedAt: new Date(), lastUsedStep: BigInt(step) },
      }),
      this.prisma.mfaFactor.deleteMany({ where: { userId, type: 'recovery_code' } }),
      this.prisma.mfaFactor.createMany({
        data: recoveryCodes.map((c) => ({
          userId,
          type: 'recovery_code' as const,
          codeHash: this.encryption.hmac(normalizeRecoveryCode(c)),
          verifiedAt: new Date(),
        })),
      }),
    ]);
    return { recoveryCodes };
  }

  /**
   * Second login step. Accepts a current TOTP code (each time step only once) or an unused
   * recovery code (each only once).
   */
  async verifyForLogin(
    userId: string,
    input: { code?: string; recoveryCode?: string },
  ): Promise<void> {
    if (input.code) {
      const factor = await this.prisma.mfaFactor.findFirst({
        where: { userId, type: 'totp', verifiedAt: { not: null } },
      });
      if (!factor) throw invalidCode();
      const step = this.matchStep(factor, userId, input.code);
      if (step === null) throw invalidCode();
      // Atomic compare-and-set prevents replaying the same code, even concurrently.
      const updated = await this.prisma.mfaFactor.updateMany({
        where: {
          id: factor.id,
          OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: BigInt(step) } }],
        },
        data: { lastUsedStep: BigInt(step) },
      });
      if (updated.count !== 1) throw invalidCode();
      return;
    }
    if (input.recoveryCode) {
      const used = await this.prisma.mfaFactor.updateMany({
        where: {
          userId,
          type: 'recovery_code',
          usedAt: null,
          codeHash: this.encryption.hmac(normalizeRecoveryCode(input.recoveryCode)),
        },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw invalidCode();
      return;
    }
    throw invalidCode();
  }

  /** Turning MFA off needs the password and a valid code, so a stolen session alone cannot. */
  async disable(userId: string, password: string, input: { code?: string; recoveryCode?: string }) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Password is incorrect.');
    }
    await this.verifyForLogin(userId, input);
    await this.prisma.mfaFactor.deleteMany({ where: { userId } });
  }

  async remainingRecoveryCodes(userId: string): Promise<number> {
    return this.prisma.mfaFactor.count({ where: { userId, type: 'recovery_code', usedAt: null } });
  }

  /** Returns the matched absolute time step, or null. Allows one step of clock drift. */
  private matchStep(
    factor: { secretEncrypted: Uint8Array | null },
    userId: string,
    code: string,
  ): number | null {
    if (!factor.secretEncrypted || !/^\d{6}$/.test(code)) return null;
    const secret = this.encryption.decrypt(factor.secretEncrypted, this.aad(userId));
    const delta = this.totp(secret, 'x').validate({ token: code, window: 1 });
    if (delta === null) return null;
    return Math.floor(Date.now() / 1000 / PERIOD_SECONDS) + delta;
  }
}
