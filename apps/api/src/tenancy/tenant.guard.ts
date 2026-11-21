import {
  createParamDecorator,
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { withPlatformAdmin, withUser, type PrismaClient, type Role } from '@propforce/db';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { MfaService } from '../auth/mfa.service';
import { hasPermission, MFA_REQUIRED_ROLES, type Permission } from './permissions';

export const TENANT_HEADER = 'x-tenant-id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantRequestContext {
  tenantId: string;
  userId: string;
  /** Null when a platform admin works in an agency they are not a member of. */
  membershipId: string | null;
  role: Role;
  /** True when a platform admin acts in an agency without being a member. Audited as 'platform'. */
  platform?: boolean;
}

export interface TenantRequest extends AuthenticatedRequest {
  tenant: TenantRequestContext;
}

const PERMISSION_KEY = 'propforce:permission';
/** Declares the permission a tenant route requires. Routes without one are refused. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Resolves the agency for this request from the X-Tenant-Id header and checks, on every request:
 * active membership, agency not suspended or cancelled, MFA for owners/admins, and the route's
 * permission. Must run after AuthGuard.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly reflector: Reflector,
    private readonly mfa: MfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<TenantRequest>();
    const userId = req.auth?.userId;
    if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');

    const tenantId = req.headers[TENANT_HEADER];
    if (typeof tenantId !== 'string' || !UUID_RE.test(tenantId)) {
      throw new AppError(
        400,
        'TENANT_REQUIRED',
        `Send the agency id in the ${TENANT_HEADER} header.`,
      );
    }

    // User context: RLS exposes only this user's own memberships.
    const membership = await withUser(this.prisma, { userId }, (tx) =>
      tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId } },
        include: { agency: { select: { status: true } } },
      }),
    );
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!membership || membership.status === 'removed') {
      // A platform admin (flag + two-factor) may work in any agency, with admin rights.
      // Every write is audited with actor type 'platform' (see audit()).
      if (await this.isPlatformAdmin(userId)) {
        const agency = await withPlatformAdmin(this.prisma, { userId }, (tx) =>
          tx.agency.findUnique({ where: { id: tenantId }, select: { id: true } }),
        );
        if (!agency) throw new AppError(404, 'NOT_FOUND', 'Agency not found.');
        if (!permission || !hasPermission('admin', permission)) {
          throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.');
        }
        req.tenant = { tenantId, userId, membershipId: null, role: 'admin', platform: true };
        return true;
      }
      throw new AppError(403, 'TENANT_FORBIDDEN', 'You are not a member of this agency.');
    }
    if (membership.status === 'suspended') {
      throw new AppError(403, 'MEMBERSHIP_SUSPENDED', 'Your access to this agency is suspended.');
    }
    if (membership.agency.status === 'suspended' || membership.agency.status === 'cancelled') {
      throw new AppError(403, 'TENANT_SUSPENDED', 'This agency is not active.');
    }
    if (MFA_REQUIRED_ROLES.includes(membership.role) && !(await this.mfa.isEnabled(userId))) {
      throw new AppError(
        403,
        'AUTH_MFA_ENROLLMENT_REQUIRED',
        'Owners and admins must turn on two-factor authentication.',
      );
    }

    if (!permission || !hasPermission(membership.role, permission)) {
      throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to do this.');
    }

    req.tenant = { tenantId, userId, membershipId: membership.id, role: membership.role };
    return true;
  }

  private async isPlatformAdmin(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true, suspendedAt: true },
    });
    return !!user?.isPlatformAdmin && !user.suspendedAt && (await this.mfa.isEnabled(userId));
  }
}

export const CurrentTenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<TenantRequest>().tenant,
);

/**
 * The caller's own membership id, for "mine" filters and agent-only scopes. A platform admin
 * working in an agency they do not belong to has none; such calls are refused rather than
 * silently widened.
 */
export function ownMembershipId(ctx: TenantRequestContext): string {
  if (!ctx.membershipId) {
    throw new AppError(
      403,
      'PERMISSION_DENIED',
      'Only members of this agency can do this. You are viewing it as a platform admin.',
    );
  }
  return ctx.membershipId;
}
