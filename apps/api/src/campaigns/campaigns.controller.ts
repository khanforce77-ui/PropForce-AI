import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import {
  campaignCreateSchema,
  campaignUpdateSchema,
  recipientsQuerySchema,
} from './campaigns.schemas';
import { CampaignsService } from './campaigns.service';

const uuid = () => new ParseUUIDPipe();

@Controller('campaigns')
@UseGuards(AuthGuard, TenantGuard)
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @RequirePermission('campaign:write')
  list(@CurrentTenant() ctx: TenantRequestContext) {
    return this.campaigns.list(ctx);
  }

  /** Connected WhatsApp numbers a campaign can send from. */
  @Get('senders')
  @RequirePermission('campaign:write')
  senders(@CurrentTenant() ctx: TenantRequestContext) {
    return this.campaigns.senders(ctx);
  }

  @Post()
  @RequirePermission('campaign:write')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.campaigns.create(ctx, parseBody(campaignCreateSchema, body));
  }

  @Get(':id')
  @RequirePermission('campaign:write')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('campaign:write')
  update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.campaigns.update(ctx, id, parseBody(campaignUpdateSchema, body));
  }

  @Get(':id/preview')
  @RequirePermission('campaign:write')
  preview(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.preview(ctx, id);
  }

  @Get(':id/recipients')
  @RequirePermission('campaign:write')
  recipients(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Query() query: unknown,
  ) {
    return this.campaigns.recipients(ctx, id, parseBody(recipientsQuerySchema, query).status);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @RequirePermission('campaign:write')
  submit(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.submit(ctx, id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermission('campaign:approve')
  approve(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.approve(ctx, id);
  }

  @Post(':id/return-to-draft')
  @HttpCode(200)
  @RequirePermission('campaign:write')
  reject(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.reject(ctx, id);
  }

  @Post(':id/send')
  @HttpCode(200)
  @RequirePermission('campaign:approve')
  send(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.sendBatch(ctx, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('campaign:write')
  cancel(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.campaigns.cancel(ctx, id);
  }
}
