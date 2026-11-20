import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { AuthGuard, CurrentAuth } from './auth.guard';
import {
  emailOnlySchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from './auth.schemas';
import { AuthService, type ClientInfo, type IssuedTokens } from './auth.service';

export const REFRESH_COOKIE = 'pf_refresh';
const REFRESH_COOKIE_PATH = '/v1/auth';
/** Custom header required on cookie-authenticated endpoints (CSRF defence with SameSite=Strict). */
export const CSRF_HEADER = 'x-propforce-csrf';

const clientInfo = (req: Request): ClientInfo => ({
  ...(req.ip ? { ip: req.ip } : {}),
  ...(req.headers['user-agent'] ? { userAgent: req.headers['user-agent'] } : {}),
});

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @HttpCode(202)
  async register(@Body() body: unknown) {
    await this.auth.register(parseBody(registerSchema, body));
    return { message: 'If the details are valid, a verification email is on its way.' };
  }

  @Post('verify-email')
  @HttpCode(204)
  async verifyEmail(@Body() body: unknown): Promise<void> {
    await this.auth.verifyEmail(parseBody(tokenSchema, body).token);
  }

  @Post('resend-verification')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resend(@Body() body: unknown) {
    await this.auth.resendVerification(parseBody(emailOnlySchema, body).email);
    return { message: 'If the account needs verification, an email is on its way.' };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { email, password } = parseBody(loginSchema, body);
    return this.issue(res, await this.auth.login(email, password, clientInfo(req)));
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.requireCsrfHeader(req);
    try {
      return this.issue(res, await this.auth.refresh(this.readCookie(req), clientInfo(req)));
    } catch (err) {
      this.clearCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.requireCsrfHeader(req);
    await this.auth.logout(this.readCookie(req));
    this.clearCookie(res);
  }

  @Post('password/forgot')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgot(@Body() body: unknown) {
    await this.auth.forgotPassword(parseBody(emailOnlySchema, body).email);
    return { message: 'If an account exists for this email, a reset link is on its way.' };
  }

  @Post('password/reset')
  @HttpCode(204)
  async reset(@Body() body: unknown): Promise<void> {
    const { token, newPassword } = parseBody(resetPasswordSchema, body);
    await this.auth.resetPassword(token, newPassword);
  }

  // ───── helpers ─────

  private issue(res: Response, tokens: IssuedTokens) {
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshTokenExpiresAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    return {
      accessToken: tokens.accessToken,
      tokenType: 'Bearer',
      expiresIn: tokens.accessTokenExpiresIn,
    };
  }

  private clearCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.config.secureCookies,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    });
  }

  private readCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === 'string' && value.length > 0 && value.length < 200 ? value : undefined;
  }

  private requireCsrfHeader(req: Request): void {
    if (req.headers[CSRF_HEADER] !== '1') {
      throw new AppError(403, 'CSRF_HEADER_MISSING', `The ${CSRF_HEADER} header is required.`);
    }
  }
}

@Controller('me')
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  me(@CurrentAuth() a: { userId: string }) {
    return this.auth.me(a.userId);
  }

  @Get('sessions')
  async sessions(@CurrentAuth() a: { userId: string; sessionId: string }) {
    return { data: await this.auth.listSessions(a.userId, a.sessionId) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(
    @CurrentAuth() a: { userId: string },
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.auth.revokeSession(a.userId, id);
  }
}
