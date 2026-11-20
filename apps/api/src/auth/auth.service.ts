import { Inject, Injectable, Logger } from '@nestjs/common';
import { withTenant, withUser, type PrismaClient } from '@propforce/db';
import { randomUUID } from 'node:crypto';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';
import { EmailSender } from '../email/email.sender';
import type { RegisterInput } from './auth.schemas';
import { generateToken, getDummyHash, hashPassword, hashToken, verifyPassword } from './crypto';
import { JwtService } from './jwt.service';

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export type LoginResult =
  { mfaRequired: false; tokens: IssuedTokens } | { mfaRequired: true; mfaToken: string };

const invalidCredentials = () =>
  new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Email or password is incorrect.');
const invalidSession = () => new AppError(401, 'AUTH_SESSION_INVALID', 'Please sign in again.');

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'agency'}-${randomUUID().slice(0, 6)}`;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly email: EmailSender,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Creates the user, the agency (tenant), its settings and the owner membership.
   * The response is identical whether or not the email already exists, so registration
   * cannot be used to discover accounts; an existing user gets a notice email instead.
   */
  async register(input: RegisterInput): Promise<void> {
    if (!this.config.supportedEmirates.includes(input.agency.emirate)) {
      throw new AppError(400, 'VALIDATION_FAILED', 'This emirate is not supported yet.', [
        {
          path: 'agency.emirate',
          message: `Supported: ${this.config.supportedEmirates.join(', ')}`,
        },
      ]);
    }

    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      await this.safeSend({
        to: input.email,
        subject: 'Someone tried to register with your email',
        text: `An account already exists for this email. If this was you, sign in or reset your password at ${this.config.webUrl}/reset-password.`,
      });
      return;
    }

    const passwordHash = await hashPassword(input.password);
    const agencyId = randomUUID();
    const user = await this.prisma.user.create({
      data: { email: input.email, fullName: input.fullName, passwordHash },
    });

    try {
      await withTenant(this.prisma, { tenantId: agencyId, userId: user.id }, async (tx) => {
        await tx.agency.create({
          data: {
            id: agencyId,
            name: input.agency.name,
            slug: slugify(input.agency.name),
            emirate: input.agency.emirate,
            settings: { create: {} },
          },
        });
        await tx.membership.create({
          data: { tenantId: agencyId, userId: user.id, role: 'owner' },
        });
        await tx.auditLog.create({
          data: {
            tenantId: agencyId,
            actorType: 'user',
            actorUserId: user.id,
            action: 'agency.registered',
            entityType: 'agency',
            entityId: agencyId,
            after: { name: input.agency.name, emirate: input.agency.emirate },
          },
        });
      });
    } catch (err) {
      // Keep registration atomic from the user's point of view.
      await this.prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
      throw err;
    }

    await this.sendVerification(user.id, user.email);
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeToken(token, 'email_verification');
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return;
    await this.sendVerification(user.id, user.email);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash) {
      await verifyPassword(await getDummyHash(), password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(user.passwordHash, password))) throw invalidCredentials();
    if (!user.emailVerifiedAt) {
      throw new AppError(403, 'AUTH_EMAIL_UNVERIFIED', 'Please verify your email address first.');
    }
    const mfaEnabled =
      (await this.prisma.mfaFactor.count({
        where: { userId: user.id, type: 'totp', verifiedAt: { not: null } },
      })) > 0;
    if (mfaEnabled) {
      return { mfaRequired: true, mfaToken: await this.jwt.signMfaChallenge(user.id) };
    }
    return { mfaRequired: false, tokens: await this.startSession(user.id, client) };
  }

  /** Completes a login once every required factor has been checked. */
  async startSession(userId: string, client: ClientInfo): Promise<IssuedTokens> {
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    return this.createSession(userId, randomUUID(), client);
  }

  /**
   * Rotates the refresh token. A token that was already rotated or revoked is treated as stolen:
   * every session in its family is revoked.
   */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedTokens> {
    if (!refreshToken) throw invalidSession();
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hashToken(refreshToken) },
    });
    if (!session) throw invalidSession();

    if (session.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token reuse detected; revoked session family ${session.familyId}`);
      throw invalidSession();
    }
    if (session.expiresAt <= new Date()) throw invalidSession();

    // Revoke atomically so two concurrent refreshes cannot both succeed.
    const revoked = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw invalidSession();

    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) throw invalidSession();
    return this.createSession(user.id, session.familyId, client);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = await this.issueToken(user.id, 'password_reset', RESET_TTL_MS);
    await this.safeSend({
      to: user.email,
      subject: 'Reset your PropForce password',
      text: `Reset your password within 30 minutes: ${this.config.webUrl}/reset-password?token=${token}\n\nIf you did not ask for this, you can ignore this email.`,
    });
  }

  /** Sets a new password and signs the user out everywhere. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.consumeToken(token, 'password_reset');
    const passwordHash = await hashPassword(newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        // Receiving the reset email also proves ownership of the address.
        data: { passwordHash, emailVerifiedAt: record.user.emailVerifiedAt ?? new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  /** Resolves an access token to an active session. Used by the auth guard. */
  async authenticate(accessToken: string): Promise<{ userId: string; sessionId: string } | null> {
    const claims = await this.jwt.verify(accessToken);
    if (!claims) return null;
    const session = await this.prisma.session.findUnique({ where: { id: claims.sid } });
    // Each access token is bound to one session row. Refresh, logout and password reset revoke
    // that row, so an old access token stops working immediately rather than at expiry.
    if (!session || session.userId !== claims.sub) return null;
    if (session.revokedAt || session.expiresAt <= new Date()) return null;
    return { userId: session.userId, sessionId: session.id };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, locale: true, emailVerifiedAt: true },
    });
    const mfaEnabled =
      (await this.prisma.mfaFactor.count({
        where: { userId, type: 'totp', verifiedAt: { not: null } },
      })) > 0;
    const memberships = await withUser(this.prisma, { userId }, (tx) =>
      tx.membership.findMany({
        where: { userId, status: 'active' },
        select: {
          id: true,
          role: true,
          agency: { select: { id: true, name: true, slug: true, emirate: true, status: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
    // Owners and admins must use two-factor authentication. Enforced on tenant routes (PR 5).
    const mfaRequired = memberships.some((m) => m.role === 'owner' || m.role === 'admin');
    return { user: { ...user, mfaEnabled }, mfaRequired, memberships };
  }

  async listSessions(userId: string, currentSessionId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, ip: true, userAgent: true, createdAt: true, expiresAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return sessions.map((s) => ({ ...s, current: s.id === currentSessionId }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const target = await this.prisma.session.findFirst({ where: { id: sessionId, userId } });
    if (!target) throw new AppError(404, 'NOT_FOUND', 'Session not found.');
    await this.prisma.session.updateMany({
      where: { familyId: target.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private async createSession(
    userId: string,
    familyId: string,
    client: ClientInfo,
  ): Promise<IssuedTokens> {
    const refreshToken = generateToken();
    const refreshTokenExpiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 86_400_000,
    );
    const session = await this.prisma.session.create({
      data: {
        userId,
        familyId,
        refreshTokenHash: hashToken(refreshToken),
        expiresAt: refreshTokenExpiresAt,
        ip: client.ip?.slice(0, 64) ?? null,
        userAgent: client.userAgent?.slice(0, 512) ?? null,
      },
    });
    const accessToken = await this.jwt.sign({ sub: userId, sid: session.id });
    return {
      accessToken,
      accessTokenExpiresIn: this.config.jwt.accessTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  private async issueToken(
    userId: string,
    type: 'email_verification' | 'password_reset',
    ttlMs: number,
  ): Promise<string> {
    const token = generateToken();
    await this.prisma.$transaction([
      // Only the latest token of each type stays usable.
      this.prisma.userToken.updateMany({
        where: { userId, type, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.userToken.create({
        data: {
          userId,
          type,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + ttlMs),
        },
      }),
    ]);
    return token;
  }

  private async consumeToken(token: string, type: 'email_verification' | 'password_reset') {
    const tokenHash = hashToken(token);
    const claimed = await this.prisma.userToken.updateMany({
      where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (claimed.count !== 1) {
      throw new AppError(400, 'AUTH_TOKEN_INVALID', 'This link is invalid or has expired.');
    }
    return this.prisma.userToken.findUniqueOrThrow({
      where: { tokenHash },
      include: { user: true },
    });
  }

  private async sendVerification(userId: string, email: string): Promise<void> {
    const token = await this.issueToken(userId, 'email_verification', VERIFICATION_TTL_MS);
    await this.safeSend({
      to: email,
      subject: 'Verify your email for PropForce AI',
      text: `Confirm your email address: ${this.config.webUrl}/verify-email?token=${token}\n\nThis link expires in 24 hours.`,
    });
  }

  /** Email failures must not reveal account state or break the request; they are logged. */
  private async safeSend(message: Parameters<EmailSender['send']>[0]): Promise<void> {
    try {
      await this.email.send(message);
    } catch (err) {
      this.logger.error(`Failed to send email "${message.subject}": ${(err as Error).message}`);
    }
  }
}
