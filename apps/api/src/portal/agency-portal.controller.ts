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
import { AgencyPortalService } from './agency-portal.service';
import {
  agentProfileSchema,
  enquiryStatusSchema,
  listEnquiriesSchema,
  listReportsSchema,
  reportStatusSchema,
} from './portal.schemas';

const uuid = () => new ParseUUIDPipe();

@Controller('portal')
@UseGuards(AuthGuard, TenantGuard)
export class AgencyPortalController {
  constructor(private readonly portal: AgencyPortalService) {}

  @Get('agents')
  @RequirePermission('property:read')
  agents(@CurrentTenant() ctx: TenantRequestContext) {
    return this.portal.agents(ctx);
  }

  @Patch('agents/:id')
  @RequirePermission('property:write')
  updateAgent(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.portal.updateAgent(ctx, id, parseBody(agentProfileSchema, body));
  }

  @Get('enquiries')
  @RequirePermission('property:read')
  enquiries(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.portal.enquiries(ctx, parseBody(listEnquiriesSchema, query));
  }

  @Post('enquiries/:id/status')
  @HttpCode(200)
  @RequirePermission('property:write')
  setStatus(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.portal.setEnquiryStatus(ctx, id, parseBody(enquiryStatusSchema, body).status);
  }

  @Get('reports')
  @RequirePermission('property:read')
  reports(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.portal.reports(ctx, parseBody(listReportsSchema, query));
  }

  @Post('reports/:id/status')
  @HttpCode(200)
  @RequirePermission('property:write')
  setReportStatus(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.portal.setReportStatus(ctx, id, parseBody(reportStatusSchema, body).status);
  }
}
