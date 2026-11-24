import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { PlatformAdminGuard } from '../platform/platform.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { ConversationsService } from './conversations.service';
import {
  connectAccountSchema,
  connectDirectSchema,
  listConversationsSchema,
  listMessagesSchema,
  sendMessageSchema,
} from './whatsapp.schemas';

const uuid = () => new ParseUUIDPipe();

@Controller()
@UseGuards(AuthGuard, TenantGuard)
export class ConversationsController {
  constructor(private readonly svc: ConversationsService) {}

  @Get('whatsapp/accounts')
  @RequirePermission('integration:manage')
  accounts(@CurrentTenant() ctx: TenantRequestContext) {
    return this.svc.listAccounts(ctx);
  }

  @Post('whatsapp/accounts')
  @RequirePermission('integration:manage')
  connect(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.svc.connectAccount(ctx, parseBody(connectAccountSchema, body));
  }

  /** Attaches a number of the business that owns the Meta app (no popup). Platform admins only. */
  @Post('whatsapp/accounts/direct')
  @UseGuards(PlatformAdminGuard)
  @RequirePermission('integration:manage')
  connectDirect(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.svc.connectDirect(ctx, parseBody(connectDirectSchema, body));
  }

  @Post('whatsapp/accounts/:id/disconnect')
  @HttpCode(204)
  @RequirePermission('integration:manage')
  async disconnect(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    await this.svc.disconnectAccount(ctx, id);
  }

  @Get('conversations')
  @RequirePermission('conversation:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.svc.list(ctx, parseBody(listConversationsSchema, q));
  }

  @Get('conversations/:id/messages')
  @RequirePermission('conversation:read')
  messages(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Query() q: unknown,
  ) {
    return this.svc.messages(ctx, id, parseBody(listMessagesSchema, q));
  }

  @Post('conversations/:id/messages')
  @RequirePermission('conversation:reply')
  send(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.svc.send(ctx, id, parseBody(sendMessageSchema, body));
  }

  @Post('conversations/:id/takeover')
  @HttpCode(200)
  @RequirePermission('conversation:reply')
  takeover(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.svc.setMode(ctx, id, 'human');
  }

  @Post('conversations/:id/release-to-ai')
  @HttpCode(200)
  @RequirePermission('conversation:reply')
  release(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.svc.setMode(ctx, id, 'ai');
  }
}
