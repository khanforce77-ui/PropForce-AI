import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
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
