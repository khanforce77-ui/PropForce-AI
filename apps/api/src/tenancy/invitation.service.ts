import { Inject, Injectable, Logger } from '@nestjs/common';
import { findInvitationByTokenHash, withTenant, type PrismaClient, type Role } from '@propforce/db';
import { AppError } from '../common/app-error';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';
import { EmailSender } from '../email/email.sender';
import { generateToken, hashPassword, hashToken } from '../auth/crypto';
import { PRIVILEGED_ROLES } from './permissions';
import { assertAgencyCanGrow, audit } from './tenancy.service';
import type { TenantRequestContext } from './tenant.guard';
import { renderEmail } from '../email/templates';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const invalidInvite = () =>
  new AppError(400, 'INVITATION_INVALID', 'This invitation is invalid or has expired.');

export interface AcceptInput {
  token: string;
  /** Required when the invited email has no account yet. */
  fullName?: string | undefined;
  password?: string | undefined;
  /** Set when the caller is signed in. */
  currentUserId?: string | undefined;
}

@Injectable()
export class InvitationService {
  private readonly logger = new Logger(InvitationService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly email: EmailSender,
  ) {}

  async create(
    ctx: TenantRequestContext,
    input: { email: string; role: Role; teamId?: string | undefined },
  ) {
    if (input.role === 'owner') {
      throw new AppError(400, 'VALIDATION_FAILED', 'Invite as admin, then promote to owner.');
    }
    if (PRIVILEGED_ROLES.includes(input.role) && ctx.role !== 'owner') {
      throw new AppError(403, 'PERMISSION_DENIED', 'Only an owner can invite admins.');
    }
    const token = generateToken();
    const { invitation, agencyName } = await withTenant(
      this.prisma,
      { tenantId: ctx.tenantId, userId: ctx.userId },
      async (tx) => {
        if (input.teamId && !(await tx.team.findUnique({ where: { id: input.teamId } }))) {
          throw new AppError(404, 'NOT_FOUND', 'Team not found.');
        }
        const existingMember = await tx.membership.findFirst({
          where: {
            tenantId: ctx.tenantId,
            status: { not: 'removed' },
            user: { email: input.email },
          },
        });
        if (existingMember) {
          throw new AppError(
            409,
            'CONFLICT_DUPLICATE',
            'This person is already a member of the agency.',
          );
        }
        // A new invitation replaces a pending one for the same email, so that one frees a seat.
        await tx.invitation.updateMany({
          where: { tenantId: ctx.tenantId, email: input.email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await assertAgencyCanGrow(tx, ctx.tenantId, 'seat');
        const invitation = await tx.invitation.create({
          data: {
            tenantId: ctx.tenantId,
            email: input.email,
            role: input.role,
            teamId: input.teamId ?? null,
            tokenHash: hashToken(token),
            invitedBy: ctx.userId,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
          select: invitationSelect,
        });
        await audit(tx, ctx, {
          action: 'member.invited',
          entityType: 'invitation',
          entityId: invitation.id,
          after: { email: input.email, role: input.role },
        });
        const agency = await tx.agency.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        return { invitation, agencyName: agency.name };
      },
    );

    try {
      await this.email.send({
        to: input.email,
        subject: `You're invited to join ${agencyName} on PropForce`,
        ...renderEmail(
          {
            preheader: `Join ${agencyName} on PropForce as ${input.role}.`,
            heading: `Join ${agencyName} on PropForce`,
            paragraphs: [
              `You have been invited to join ${agencyName} as ${input.role.replace(/_/g, ' ')}.`,
              'PropForce is where the team manages listings, leads and client chats.',
            ],
            button: {
              label: 'Accept invitation',
              url: `${this.config.webUrl}/accept-invite?token=${token}`,
            },
            footnote:
              'This invitation expires in 7 days. If you were not expecting it, ignore this email.',
          },
          this.config.webUrl,
        ),
      });
    } catch (err) {
      this.logger.error(`Invitation email failed: ${(err as Error).message}`);
    }
    return invitation;
  }

  list(ctx: TenantRequestContext) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId }, (tx) =>
      tx.invitation.findMany({
        where: {
          tenantId: ctx.tenantId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: invitationSelect,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  revoke(ctx: TenantRequestContext, invitationId: string) {
    return withTenant(this.prisma, { tenantId: ctx.tenantId, userId: ctx.userId }, async (tx) => {
      const revoked = await tx.invitation.updateMany({
        where: { id: invitationId, tenantId: ctx.tenantId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) throw new AppError(404, 'NOT_FOUND', 'Invitation not found.');
      await audit(tx, ctx, {
        action: 'invitation.revoked',
        entityType: 'invitation',
        entityId: invitationId,
      });
    });
  }

  /**
   * Accepts an invitation. A new person sets a name and password (the invite email proves the
   * address). An existing account must be signed in as that same email, so a leaked link cannot
   * attach someone else's account.
   */
  async accept(
    input: AcceptInput,
  ): Promise<{ tenantId: string; membershipId: string; newAccount: boolean }> {
    const invitation = await findInvitationByTokenHash(this.prisma, hashToken(input.token));
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= new Date()
    ) {
      throw invalidInvite();
    }

    let user = await this.prisma.user.findUnique({ where: { email: invitation.email } });
    let newAccount = false;
    if (user) {
      if (input.currentUserId !== user.id) {
        throw new AppError(
          401,
          'INVITATION_SIGN_IN_REQUIRED',
          'Sign in with the invited email address to accept this invitation.',
        );
      }
    } else {
      if (!input.fullName || !input.password) {
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'Name and password are required to create your account.',
        );
      }
      user = await this.prisma.user.create({
        data: {
          email: invitation.email,
          fullName: input.fullName,
          passwordHash: await hashPassword(input.password),
          emailVerifiedAt: new Date(),
        },
      });
      newAccount = true;
    }

    const userId = user.id;
    const membership = await withTenant(
      this.prisma,
      { tenantId: invitation.tenantId, userId },
      async (tx) => {
        const claimed = await tx.invitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) throw invalidInvite();

        const existing = await tx.membership.findUnique({
          where: { tenantId_userId: { tenantId: invitation.tenantId, userId } },
        });
        if (existing && existing.status !== 'removed') {
          throw new AppError(409, 'CONFLICT_DUPLICATE', 'You are already a member of this agency.');
        }
        const m = existing
          ? await tx.membership.update({
              where: { id: existing.id },
              data: { role: invitation.role, teamId: invitation.teamId, status: 'active' },
            })
          : await tx.membership.create({
              data: {
                tenantId: invitation.tenantId,
                userId,
                role: invitation.role,
                teamId: invitation.teamId,
              },
            });
        await tx.auditLog.create({
          data: {
            tenantId: invitation.tenantId,
            actorType: 'user',
            actorUserId: userId,
            action: 'invitation.accepted',
            entityType: 'membership',
            entityId: m.id,
            after: { role: m.role, invitationId: invitation.id },
          },
        });
        return m;
      },
    );

    return { tenantId: invitation.tenantId, membershipId: membership.id, newAccount };
  }
}

const invitationSelect = {
  id: true,
  email: true,
  role: true,
  teamId: true,
  expiresAt: true,
  createdAt: true,
} as const;
