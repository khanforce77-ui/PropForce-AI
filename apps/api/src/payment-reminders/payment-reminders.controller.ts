import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
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
import { PaymentPlansService } from './payment-plans.service';
import {
  channelSchema,
  configUpdateSchema,
  installmentAddSchema,
  installmentUpdateSchema,
  listPlansSchema,
  logQuerySchema,
  planCreateSchema,
  planUpdateSchema,
  previewSchema,
  stageSchema,
  templateParamsSchema,
  templateUpdateSchema,
} from './payment-reminders.schemas';
import { PaymentRemindersService } from './payment-reminders.service';

const uuid = () => new ParseUUIDPipe();

@Controller('payment-plans')
@UseGuards(AuthGuard, TenantGuard)
export class PaymentPlansController {
  constructor(private readonly plans: PaymentPlansService) {}

  @Get()
  @RequirePermission('payment:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.plans.list(ctx, parseBody(listPlansSchema, q));
  }

  @Post()
  @RequirePermission('payment:write')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.plans.create(ctx, parseBody(planCreateSchema, body));
  }

  @Get(':id')
  @RequirePermission('payment:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.plans.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('payment:write')
  update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.plans.update(ctx, id, parseBody(planUpdateSchema, body));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('payment:settings')
  async remove(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    await this.plans.remove(ctx, id);
  }

  @Post(':id/consent')
  @RequirePermission('payment:write')
  consent(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    const b = parseBody(
      z.strictObject({ channel: channelSchema, status: z.enum(['granted', 'withdrawn']) }),
      body,
    );
    return this.plans.setConsent(ctx, id, b.channel, b.status);
  }

  @Post(':id/installments')
  @RequirePermission('payment:write')
  addInstallment(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.plans.addInstallment(ctx, id, parseBody(installmentAddSchema, body));
  }

  @Patch(':id/installments/:installmentId')
  @RequirePermission('payment:write')
  updateInstallment(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('installmentId', uuid()) installmentId: string,
    @Body() body: unknown,
  ) {
    return this.plans.updateInstallment(
      ctx,
      id,
      installmentId,
      parseBody(installmentUpdateSchema, body),
    );
  }

  @Delete(':id/installments/:installmentId')
  @RequirePermission('payment:write')
  removeInstallment(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('installmentId', uuid()) installmentId: string,
  ) {
    return this.plans.removeInstallment(ctx, id, installmentId);
  }
}

@Controller('payment-reminders')
@UseGuards(AuthGuard, TenantGuard)
export class PaymentRemindersController {
  constructor(private readonly reminders: PaymentRemindersService) {}

  @Get('config')
  @RequirePermission('payment:read')
  config(@CurrentTenant() ctx: TenantRequestContext) {
    return this.reminders.getConfig(ctx);
  }

  @Put('config')
  @RequirePermission('payment:settings')
  updateConfig(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.reminders.updateConfig(ctx, parseBody(configUpdateSchema, body));
  }

  @Get('templates')
  @RequirePermission('payment:read')
  templates(@CurrentTenant() ctx: TenantRequestContext) {
    return this.reminders.listTemplates(ctx);
  }

  @Put('templates/:channel/:stage')
  @RequirePermission('payment:settings')
  saveTemplate(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param() params: unknown,
    @Body() body: unknown,
  ) {
    const p = parseBody(templateParamsSchema, params);
    return this.reminders.saveTemplate(
      ctx,
      p.channel,
      p.stage,
      parseBody(templateUpdateSchema, body),
    );
  }

  @Delete('templates/:channel/:stage')
  @RequirePermission('payment:settings')
  resetTemplate(@CurrentTenant() ctx: TenantRequestContext, @Param() params: unknown) {
    const p = parseBody(templateParamsSchema, params);
    return this.reminders.resetTemplate(ctx, p.channel, p.stage);
  }

  @Post('preview')
  @HttpCode(200)
  @RequirePermission('payment:read')
  preview(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.reminders.preview(ctx, parseBody(previewSchema, body));
  }

  @Post('test-email')
  @HttpCode(200)
  @RequirePermission('payment:settings')
  testEmail(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.reminders.sendTestEmail(
      ctx,
      parseBody(z.strictObject({ stage: stageSchema }), body).stage,
    );
  }

  @Get('log')
  @RequirePermission('payment:read')
  log(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.reminders.log(ctx, parseBody(logQuerySchema, q));
  }

  @Post('run')
  @HttpCode(200)
  @RequirePermission('payment:settings')
  run(@CurrentTenant() ctx: TenantRequestContext) {
    return this.reminders.runForTenant(ctx);
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Scheduled jobs. Vercel Cron calls these with `Authorization: Bearer $CRON_SECRET`. */
@Controller('cron')
export class CronController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reminders: PaymentRemindersService,
  ) {}

  @Get('payment-reminders')
  async paymentReminders(@Headers('authorization') authorization?: string) {
    const secret = this.config.cronSecret;
    if (!secret) {
      throw new AppError(503, 'INTEGRATION_NOT_CONFIGURED', 'Scheduled jobs are not configured.');
    }
    const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!timingSafeEqual(digest(given), digest(secret))) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Invalid cron credentials.');
    }
    return this.reminders.runAll();
  }
}
