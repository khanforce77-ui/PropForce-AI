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
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AppError } from '../common/app-error';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import {
  listPropertiesSchema,
  permitDocumentQuery,
  permitSchema,
  permitUpdateSchema,
  projectSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  statusSchema,
} from './inventory.schemas';
import { InventoryService } from './inventory.service';

const uuid = () => new ParseUUIDPipe();

@Controller()
@UseGuards(AuthGuard, TenantGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('dashboard/summary')
  @RequirePermission('agency:read')
  summary(@CurrentTenant() ctx: TenantRequestContext) {
    return this.inventory.summary(ctx);
  }

  @Get('properties')
  @RequirePermission('property:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.inventory.list(ctx, parseBody(listPropertiesSchema, query));
  }

  @Post('properties')
  @RequirePermission('property:write')
  create(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.inventory.create(ctx, parseBody(propertyCreateSchema, body));
  }

  @Get('properties/:id')
  @RequirePermission('property:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.inventory.get(ctx, id);
  }

  @Patch('properties/:id')
  @RequirePermission('property:write')
  update(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.inventory.update(ctx, id, parseBody(propertyUpdateSchema, body));
  }

  @Post('properties/:id/status')
  @HttpCode(200)
  @RequirePermission('property:write')
  setStatus(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.inventory.setStatus(ctx, id, parseBody(statusSchema, body).status);
  }

  @Post('properties/:id/verify')
  @HttpCode(200)
  @RequirePermission('property:write')
  verify(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.inventory.verify(ctx, id);
  }

  @Delete('properties/:id')
  @HttpCode(204)
  @RequirePermission('property:write')
  async remove(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
  ): Promise<void> {
    await this.inventory.remove(ctx, id);
  }

  @Post('properties/:id/permits')
  @RequirePermission('property:write')
  addPermit(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.inventory.addPermit(ctx, id, parseBody(permitSchema, body));
  }

  @Patch('properties/:id/permits/:permitId')
  @RequirePermission('property:write')
  updatePermit(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('permitId', uuid()) permitId: string,
    @Body() body: unknown,
  ) {
    return this.inventory.updatePermit(ctx, id, permitId, parseBody(permitUpdateSchema, body));
  }

  /** The permit document as the raw file body (PDF or image); ?fileName= gives its name. */
  @Put('properties/:id/permits/:permitId/document')
  @RequirePermission('property:write')
  setPermitDocument(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('permitId', uuid()) permitId: string,
    @Query() query: unknown,
    @Body() body: unknown,
  ) {
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new AppError(
        415,
        'UNSUPPORTED_IMAGE',
        'Send the file itself as the request body with a PDF or image Content-Type.',
      );
    }
    const { fileName } = parseBody(permitDocumentQuery, query);
    return this.inventory.setPermitDocument(ctx, id, permitId, fileName, body);
  }

  @Get('properties/:id/permits/:permitId/document')
  @RequirePermission('property:read')
  async permitDocument(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('permitId', uuid()) permitId: string,
    @Res() res: Response,
  ) {
    const doc = await this.inventory.permitDocument(ctx, id, permitId);
    res.set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `attachment; filename="${doc.fileName.replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    res.send(Buffer.from(doc.bytes));
  }

  @Delete('properties/:id/permits/:permitId')
  @HttpCode(204)
  @RequirePermission('property:write')
  async removePermit(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('permitId', uuid()) permitId: string,
  ): Promise<void> {
    await this.inventory.removePermit(ctx, id, permitId);
  }

  @Get('projects')
  @RequirePermission('property:read')
  async listProjects(@CurrentTenant() ctx: TenantRequestContext) {
    return { data: await this.inventory.listProjects(ctx) };
  }

  @Post('projects')
  @RequirePermission('property:manage')
  createProject(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.inventory.createProject(ctx, parseBody(projectSchema, body));
  }
}
