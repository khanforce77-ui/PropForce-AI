import {
  Body,
  Controller,
  Delete,
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
  consentSchema,
  contactBulkSchema,
  contactCreateSchema,
  contactUpdateSchema,
  leadAssignSchema,
  leadCreateSchema,
  leadNoteSchema,
  leadStageSchema,
  leadUpdateSchema,
  listContactsSchema,
  listLeadsSchema,
} from './crm.schemas';
import { CrmService } from './crm.service';

const uuid = () => new ParseUUIDPipe();

@Controller()
@UseGuards(AuthGuard, TenantGuard)
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @Get('crm/summary')
  @RequirePermission('crm:read')
  summary(@CurrentTenant() ctx: TenantRequestContext) {
    return this.crm.summary(ctx);
  }

  // ───── contacts ─────

  @Get('contacts')
  @RequirePermission('crm:read')
  listContacts(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.crm.listContacts(ctx, parseBody(listContactsSchema, query));
  }

  @Post('contacts')
  @RequirePermission('crm:write')
  createContact(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.crm.createContact(ctx, parseBody(contactCreateSchema, body));
  }

  @Post('contacts/bulk')
  @RequirePermission('crm:write')
  bulkAddContacts(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.crm.bulkAddContacts(ctx, parseBody(contactBulkSchema, body));
  }

  @Get('contacts/:id')
  @RequirePermission('crm:read')
  getContact(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.crm.getContact(ctx, id);
  }

  @Patch('contacts/:id')
  @RequirePermission('crm:write')
  updateContact(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.crm.updateContact(ctx, id, parseBody(contactUpdateSchema, body));
  }

  @Delete('contacts/:id')
  @HttpCode(204)
  @RequirePermission('crm:manage')
  async eraseContact(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    await this.crm.eraseContact(ctx, id);
  }

  @Post('contacts/:id/consents')
  @RequirePermission('crm:write')
  recordConsent(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.crm.recordConsent(ctx, id, parseBody(consentSchema, body));
  }

  // ───── leads ─────

  @Get('leads')
  @RequirePermission('crm:read')
  listLeads(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.crm.listLeads(ctx, parseBody(listLeadsSchema, query));
  }

  @Post('leads')
  @RequirePermission('crm:write')
  createLead(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.crm.createLead(ctx, parseBody(leadCreateSchema, body));
  }

  @Get('leads/:id')
  @RequirePermission('crm:read')
  getLead(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.crm.getLead(ctx, id);
  }

  @Patch('leads/:id')
  @RequirePermission('crm:write')
  updateLead(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.crm.updateLead(ctx, id, parseBody(leadUpdateSchema, body));
  }

  @Post('leads/:id/stage')
  @HttpCode(200)
  @RequirePermission('crm:write')
  setStage(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.crm.setStage(ctx, id, parseBody(leadStageSchema, body));
  }

  @Post('leads/:id/assign')
  @HttpCode(200)
  @RequirePermission('crm:manage')
  assign(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.crm.assign(ctx, id, parseBody(leadAssignSchema, body).membershipId);
  }

  @Post('leads/:id/notes')
  @RequirePermission('crm:write')
  addNote(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.crm.addNote(ctx, id, parseBody(leadNoteSchema, body).body);
  }

  @Delete('leads/:id')
  @HttpCode(204)
  @RequirePermission('crm:manage')
  async removeLead(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    await this.crm.removeLead(ctx, id);
  }
}
