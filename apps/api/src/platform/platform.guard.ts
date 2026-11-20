import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { PrismaClient } from '@propforce/db';
import type { AuthenticatedRequest } from '../auth/auth.guard';
import { MfaService } from '../auth/mfa.service';
import { AppError } from '../common/app-error';
import { PRISMA } from '../database/database.module';

/**
 * Platform (super admin) routes: the signed-in user must have the platform-admin flag and
 * two-factor authentication turned on. Checked on every request. Must run after AuthGuard.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly mfa: MfaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = req.auth?.userId;
    if (!userId) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isPlatformAdmin: true },
    });
    if (!user?.isPlatformAdmin) {
      throw new AppError(403, 'PERMISSION_DENIED', 'Platform administrators only.');
    }
    if (!(await this.mfa.isEnabled(userId))) {
      throw new AppError(
        403,
        'MFA_REQUIRED',
        'Turn on two-factor authentication to use the platform admin area.',
      );
    }
    return true;
  }
}
