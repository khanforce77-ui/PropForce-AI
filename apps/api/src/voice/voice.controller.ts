import { timingSafeEqual } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { parseVapiMessage } from './vapi-report';
import { lineCreateSchema, lineUpdateSchema, listCallsSchema } from './voice.schemas';
import { VoiceService } from './voice.service';

const uuid = () => new ParseUUIDPipe();

function sameSecret(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Vapi server URL (public). Authenticated by the shared secret configured as a Vapi credential:
 * `Authorization: Bearer <secret>` or the legacy `X-Vapi-Secret: <secret>` header.
 */
@Controller('webhooks/voice')
export class VoiceWebhookController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly voice: VoiceService,
  ) {}

  @Post('vapi')
  @HttpCode(200)
  async vapi(@Req() req: Request, @Body() body: unknown) {
    const secret = this.config.voice.webhookSecret;
    if (!secret) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'Voice is not configured.');
    }
    const auth = req.header('authorization');
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!sameSecret(bearer, secret) && !sameSecret(req.header('x-vapi-secret'), secret)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Invalid webhook credentials.');
    }
    const { type, report } = parseVapiMessage(body);
    if (!report) return { received: true, type };
    const outcome = await this.voice.recordCall(report);
    return { received: true, type, outcome };
  }
}

@Controller()
@UseGuards(AuthGuard, TenantGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Get('calls')
  @RequirePermission('crm:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.voice.listCalls(ctx, parseBody(listCallsSchema, q));
  }

  @Get('calls/:id')
  @RequirePermission('crm:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.voice.getCall(ctx, id);
  }

  @Get('voice/lines')
  @RequirePermission('integration:manage')
  lines(@CurrentTenant() ctx: TenantRequestContext) {
    return this.voice.listLines(ctx);
  }

  @Post('voice/lines')
  @RequirePermission('integration:manage')
  addLine(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.voice.createLine(ctx, parseBody(lineCreateSchema, body));
  }

  @Patch('voice/lines/:id')
  @RequirePermission('integration:manage')
  updateLine(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.voice.updateLine(ctx, id, parseBody(lineUpdateSchema, body));
  }
}
