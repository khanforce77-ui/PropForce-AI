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
  commissionStatusSchema,
  dealCreateSchema,
  dealStageSchema,
  dealUpdateSchema,
  listDealsSchema,
  splitsSchema,
  summarySchema,
  taskCreateSchema,
  taskUpdateSchema,
} from './deals.schemas';
import { DealsService } from './deals.service';

const uuid = () => new ParseUUIDPipe();

@Controller('deals')
@UseGuards(AuthGuard, TenantGuard)
export class DealsController {
  constructor(private readonly deals: DealsService) {}

  @Get()
  @RequirePermission('crm:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.deals.list(ctx, parseBody(listDealsSchema, q));
  }

  @Get('summary')
  @RequirePermission('crm:read')
  summary(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.deals.summary(ctx, parseBody(summarySchema, q).type);
  }

  @Post()
  @RequirePermission('crm:write')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.deals.create(ctx, parseBody(dealCreateSchema, body));
  }

  @Get(':id')
  @RequirePermission('crm:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.deals.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission('crm:write')
  update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.deals.update(ctx, id, parseBody(dealUpdateSchema, body));
  }

  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermission('crm:write')
  stage(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.deals.setStage(ctx, id, parseBody(dealStageSchema, body));
  }

  @Post(':id/splits')
  @HttpCode(200)
  @RequirePermission('crm:manage')
  splits(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.deals.setSplits(ctx, id, parseBody(splitsSchema, body));
  }

  @Post(':id/commission')
  @HttpCode(200)
  @RequirePermission('crm:manage')
  commission(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.deals.setCommissionStatus(ctx, id, parseBody(commissionStatusSchema, body));
  }

  @Post(':id/tasks')
  @RequirePermission('crm:write')
  addTask(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.deals.addTask(ctx, id, parseBody(taskCreateSchema, body));
  }

  @Patch(':id/tasks/:taskId')
  @RequirePermission('crm:write')
  updateTask(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('taskId', uuid()) taskId: string,
    @Body() body: unknown,
  ) {
    return this.deals.updateTask(ctx, id, taskId, parseBody(taskUpdateSchema, body));
  }

  @Delete(':id/tasks/:taskId')
  @HttpCode(204)
  @RequirePermission('crm:write')
  async removeTask(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('taskId', uuid()) taskId: string,
  ) {
    await this.deals.removeTask(ctx, id, taskId);
  }
}
