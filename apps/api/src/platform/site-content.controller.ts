import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/zod';
import { PlatformAdminGuard } from './platform.guard';
import { bannerCreateSchema, bannerUpdateSchema } from './site-content.schemas';
import { SiteContentService, type SiteKey } from './site-content.service';

const uuid = () => new ParseUUIDPipe();

function siteKey(key: string): SiteKey {
  if (key === 'portal' || key === 'platform') return key;
  throw new AppError(404, 'NOT_FOUND', 'Setting not found.');
}

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

function sendWebp(res: Response, file: { bytes: Buffer; etag: string }, cache: string) {
  res.set({
    'Content-Type': 'image/webp',
    'Cache-Control': cache,
    ETag: `"${file.etag}"`,
    'Content-Security-Policy': "default-src 'none'",
    'Content-Disposition': 'inline',
  });
  res.send(file.bytes);
}

/** Website content and platform settings. Platform admins with two-factor only. */
@Controller('platform/site')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformSiteController {
  constructor(private readonly site: SiteContentService) {}

  @Get()
  async all() {
    const [portal, platform, banners] = await Promise.all([
      this.site.read('portal'),
      this.site.read('platform'),
      this.site.listBanners(),
    ]);
    return { portal, platform, banners };
  }

  @Put('settings/:key')
  save(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() body: unknown) {
    return this.site.write(req.auth.userId, siteKey(key), body);
  }

  @Post('banners')
  createBanner(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.site.createBanner(req.auth.userId, parseBody(bannerCreateSchema, body));
  }

  @Patch('banners/:id')
  updateBanner(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.site.updateBanner(req.auth.userId, id, parseBody(bannerUpdateSchema, body));
  }

  @Put('banners/:id/image')
  setImage(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.site.setBannerImage(req.auth.userId, id, imageBody(body));
  }

  @Get('banners/:id/image')
  async image(@Param('id', uuid()) id: string, @Res() res: Response) {
    sendWebp(res, await this.site.adminImage(id), 'private, no-store');
  }

  @Delete('banners/:id')
  @HttpCode(204)
  async deleteBanner(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    await this.site.deleteBanner(req.auth.userId, id);
  }
}

/** The public website reads its text and live banners here. */
@Controller('public/site')
export class PublicSiteController {
  constructor(private readonly site: SiteContentService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300')
  get() {
    return this.site.publicSite();
  }

  /** URLs carry ?v=<image version>, so a new image gets a new URL. */
  @Get('banners/:id/image')
  async image(@Param('id', uuid()) id: string, @Res() res: Response) {
    sendWebp(res, await this.site.publicImage(id), 'public, max-age=86400, s-maxage=86400');
  }

  @Post('banners/:id/click')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  click(@Param('id', uuid()) id: string) {
    return this.site.click(id);
  }
}

/** Any signed-in user: the notice platform admins show inside every agency's app. */
@Controller('notice')
@UseGuards(AuthGuard)
export class AppNoticeController {
  constructor(private readonly site: SiteContentService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  async get() {
    return { notice: await this.site.appNotice() };
  }
}
