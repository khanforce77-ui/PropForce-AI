import {
  Body,
  Controller,
  Get,
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
  availabilitySchema,
  listViewingsSchema,
  viewingCreateSchema,
  viewingStatusSchema,
  viewingUpdateSchema,
} from './viewings.schemas';
import { ViewingsService } from './viewings.service';

const uuid = () => new ParseUUIDPipe();

@Controller('viewings')
@UseGuards(AuthGuard, TenantGuard)
export class ViewingsController {
  constructor(private readonly viewings: ViewingsService) {}

  @Get()
  @RequirePermission('crm:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.viewings.list(ctx, parseBody(listViewingsSchema, query));
  }

  @Get('availability')
  @RequirePermission('crm:read')
  availability(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.viewings.availability(ctx, parseBody(availabilitySchema, query));
  }

  @Get(':id')
  @RequirePermission('crm:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.viewings.get(ctx, id);
  }

  @Post()
  @RequirePermission('crm:write')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.viewings.create(ctx, parseBody(viewingCreateSchema, body));
  }

  @Patch(':id')
  @RequirePermission('crm:write')
  update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.viewings.update(ctx, id, parseBody(viewingUpdateSchema, body));
  }

  @Post(':id/status')
  @RequirePermission('crm:write')
  setStatus(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.viewings.setStatus(ctx, id, parseBody(viewingStatusSchema, body));
  }
}
