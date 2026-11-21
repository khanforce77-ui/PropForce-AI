import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { PhotosService, type PublicVariant, type Variant } from './photos.service';

const uuid = () => new ParseUUIDPipe();
const reorderSchema = z.strictObject({ ids: z.array(z.uuid()).max(100) });

/** Uploads are sent as the raw image bytes (Content-Type image/*), not JSON or a form. */
function imageBody(body: unknown): Buffer {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError(
      415,
      'UNSUPPORTED_IMAGE',
      'Send the image itself as the request body with an image Content-Type.',
    );
  }
  return body;
}

function variant(v: string, allowOriginal: boolean): Variant {
  if (v === 'display' || v === 'thumb' || (allowOriginal && v === 'original')) return v;
  throw new AppError(404, 'NOT_FOUND', 'Photo not found.');
}

const sendImage = (
  res: Response,
  file: { bytes: Buffer; contentType: string; etag: string },
  cache: string,
) => {
  res.set({
    'Content-Type': file.contentType,
    'Cache-Control': cache,
    ETag: `"${file.etag}"`,
    'Content-Security-Policy': "default-src 'none'",
    'Content-Disposition': 'inline',
  });
  res.send(file.bytes);
};

@Controller('properties/:id/photos')
@UseGuards(AuthGuard, TenantGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @RequirePermission('property:read')
  list(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.photos.list(ctx, id);
  }

  @Post()
  @RequirePermission('property:write')
  add(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.photos.add(ctx, id, imageBody(body));
  }

  @Put('order')
  @RequirePermission('property:write')
  reorder(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.photos.reorder(ctx, id, parseBody(reorderSchema, body).ids);
  }

  @Delete(':photoId')
  @HttpCode(204)
  @RequirePermission('property:write')
  remove(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('photoId', uuid()) photoId: string,
  ) {
    return this.photos.remove(ctx, id, photoId);
  }

  /** display and thumb are watermarked; original is the agency's clean copy. */
  @Get(':photoId/:variant')
  @RequirePermission('property:read')
  async file(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('photoId', uuid()) photoId: string,
    @Param('variant') v: string,
    @Res() res: Response,
  ) {
    const file = await this.photos.file(ctx, id, photoId, variant(v, true));
    sendImage(res, file, 'private, no-store');
  }
}

@Controller('agency/logo')
@UseGuards(AuthGuard, TenantGuard)
export class AgencyLogoController {
  constructor(private readonly photos: PhotosService) {}

  @Get()
  @RequirePermission('agency:read')
  get(@CurrentTenant() ctx: TenantRequestContext) {
    return this.photos.getLogo(ctx);
  }

  @Put()
  @RequirePermission('agency:settings')
  set(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.photos.setLogo(ctx, imageBody(body));
  }

  @Delete()
  @HttpCode(200)
  @RequirePermission('agency:settings')
  remove(@CurrentTenant() ctx: TenantRequestContext) {
    return this.photos.removeLogo(ctx);
  }
}

/** Watermarked listing photos for the public portal. URLs carry ?v=<version>, so they cache for a year. */
@Controller('public/listing-photos')
export class PublicListingPhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Get(':photoId/:variant')
  async get(
    @Param('photoId', uuid()) photoId: string,
    @Param('variant') v: string,
    @Res() res: Response,
  ) {
    const which = variant(v, false) as PublicVariant;
    const file = await this.photos.publicFile(photoId, which);
    if (!file) throw new AppError(404, 'NOT_FOUND', 'Photo not found.');
    sendImage(res, { ...file, contentType: 'image/webp' }, 'public, max-age=31536000, immutable');
  }
}
