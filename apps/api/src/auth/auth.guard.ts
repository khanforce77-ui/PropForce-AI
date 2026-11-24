import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { AppError } from '../common/app-error';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest extends Request {
  auth: { userId: string; sessionId: string };
}

/** Requires a valid Bearer access token bound to a live session. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const result = token ? await this.auth.authenticate(token) : null;
    if (!result) throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
    req.auth = result;
    return true;
  }
}

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth,
);

/**
 * Rate limits signed-in routes per account rather than per IP address. Brute force against a
 * code is an attack on one account, and many agents in one office share an IP address, so one
 * person's attempts must not lock out their colleagues. Runs after {@link AuthGuard}.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const auth = (req as Partial<AuthenticatedRequest>).auth;
    return auth?.userId ? `user:${auth.userId}` : String(req.ip ?? 'unknown');
  }
}
