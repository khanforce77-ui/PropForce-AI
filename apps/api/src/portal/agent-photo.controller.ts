import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { AgentPhotoService } from './agent-photo.service';

const uuid = () => new ParseUUIDPipe();
const photoSchema = z.strictObject({ image: z.string().max(100_000) });

@Controller('portal/agents/:id/photo')
@UseGuards(AuthGuard, TenantGuard)
export class AgentPhotoController {
  constructor(private readonly photos: AgentPhotoService) {}

  @Get()
  @RequirePermission('property:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.photos.get(ctx, id);
  }

  @Put()
  @RequirePermission('property:write')
  set(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.photos.set(ctx, id, parseBody(photoSchema, body).image);
  }

  @Delete()
  @HttpCode(204)
  @RequirePermission('property:write')
  remove(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.photos.remove(ctx, id);
  }
}

/** The photo itself, for the public portal. The URL carries the hash, so it is cached for a year. */
@Controller('public/agents/:id/photo')
export class PublicAgentPhotoController {
  constructor(private readonly photos: AgentPhotoService) {}

  @Get()
  async get(@Param('id', uuid()) id: string, @Res() res: Response) {
    const photo = await this.photos.publicPhoto(id);
    if (!photo) throw new AppError(404, 'NOT_FOUND', 'No photo.');
    res.set({
      'Content-Type': photo.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${photo.sha256}"`,
      'Content-Security-Policy': "default-src 'none'",
      'Content-Disposition': 'inline',
    });
    res.send(Buffer.from(photo.bytes));
  }
}
