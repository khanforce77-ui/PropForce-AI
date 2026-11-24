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
import { AuthGuard, CurrentAuth, UserThrottlerGuard } from './auth.guard';
import {
  emailOnlySchema,
  loginSchema,
  mfaDisableSchema,
  mfaLoginSchema,
  totpConfirmSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from './auth.schemas';
import { AuthService, type ClientInfo, type IssuedTokens } from './auth.service';
import { JwtService } from './jwt.service';
import { MfaService } from './mfa.service';

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
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
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
    const result = await this.auth.login(email, password, clientInfo(req));
    if (result.mfaRequired) {
      res.setHeader('Cache-Control', 'no-store');
      return { mfaRequired: true, mfaToken: result.mfaToken };
    }
    return this.issue(res, result.tokens);
  }

  /** Second login step: exchange the MFA challenge token plus a code for a session. */
  @Post('mfa/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verifyMfa(
    @Body() body: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { mfaToken, code, recoveryCode } = parseBody(mfaLoginSchema, body);
    const userId = await this.jwt.verifyMfaChallenge(mfaToken);
    if (!userId) throw new AppError(401, 'AUTH_MFA_CHALLENGE_INVALID', 'Please sign in again.');
    await this.mfa.verifyForLogin(userId, {
      ...(code ? { code } : {}),
      ...(recoveryCode ? { recoveryCode } : {}),
    });
    return this.issue(res, await this.auth.startSession(userId, clientInfo(req)));
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
@UseGuards(AuthGuard, UserThrottlerGuard)
export class MeController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
  ) {}

  @Post('mfa/totp/setup')
  @HttpCode(200)
  async totpSetup(@CurrentAuth() a: { userId: string }, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    return this.mfa.beginTotpSetup(a.userId);
  }

  @Post('mfa/totp/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async totpConfirm(
    @CurrentAuth() a: { userId: string },
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    return this.mfa.confirmTotpSetup(a.userId, parseBody(totpConfirmSchema, body).code);
  }

  @Post('mfa/disable')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async mfaDisable(@CurrentAuth() a: { userId: string }, @Body() body: unknown): Promise<void> {
    const { password, code, recoveryCode } = parseBody(mfaDisableSchema, body);
    await this.mfa.disable(a.userId, password, {
      ...(code ? { code } : {}),
      ...(recoveryCode ? { recoveryCode } : {}),
    });
  }

  @Get('mfa')
  async mfaStatus(@CurrentAuth() a: { userId: string }) {
    return {
      enabled: await this.mfa.isEnabled(a.userId),
      recoveryCodesRemaining: await this.mfa.remainingRecoveryCodes(a.userId),
    };
  }

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
