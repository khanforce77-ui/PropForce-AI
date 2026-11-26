import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { parseBody } from '../common/zod';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { contactSchema, enquirySchema, publicSearchSchema, reportSchema } from './portal.schemas';
import { PublicPortalService, type Visitor } from './public-portal.service';

const uuid = () => new ParseUUIDPipe();
const CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=300';

/**
 * Anonymous, read-mostly endpoints for the public property portal. Every query runs through
 * withPublicPortal, so the database itself limits what can be seen.
 */
@Controller('public')
export class PublicPortalController {
  constructor(
    private readonly portal: PublicPortalService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get('listings')
  @Header('Cache-Control', CACHE)
  search(@Query() query: unknown) {
    return this.portal.search(parseBody(publicSearchSchema, query));
  }

  @Get('listings/:id')
  @Header('Cache-Control', CACHE)
  get(@Param('id', uuid()) id: string) {
    return this.portal.get(id);
  }

  @Get('listings/:id/similar')
  @Header('Cache-Control', CACHE)
  similar(@Param('id', uuid()) id: string) {
    return this.portal.similar(id);
  }

  @Get('agents/:id')
  @Header('Cache-Control', CACHE)
  agent(@Param('id', uuid()) id: string) {
    return this.portal.agent(id);
  }

  @Get('facets')
  @Header('Cache-Control', CACHE)
  facets() {
    return this.portal.facets();
  }

  @Get('insights')
  @Header('Cache-Control', CACHE)
  insights() {
    return this.portal.insights();
  }

  @Get('sitemap')
  @Header('Cache-Control', CACHE)
  sitemap() {
    return this.portal.sitemap();
  }

  @Post('listings/:id/contact')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  contact(@Param('id', uuid()) id: string, @Body() body: unknown, @Req() req: Request) {
    const { channel } = parseBody(contactSchema, body);
    return this.portal.contact(id, channel, this.visitor(req));
  }

  @Post('listings/:id/enquiries')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  enquire(@Param('id', uuid()) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.portal.enquire(id, parseBody(enquirySchema, body), this.visitor(req));
  }

  @Post('listings/:id/reports')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  reportListing(@Param('id', uuid()) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.portal.report(id, parseBody(reportSchema, body), this.visitor(req));
  }

  /**
   * The portal's server calls on behalf of visitors; it may pass the visitor's IP, which is
   * trusted only together with the shared key. Otherwise the edge-provided client IP is used.
   */
  private visitor(req: Request): Visitor {
    const header = (name: string) => {
      const v = req.headers[name];
      return typeof v === 'string' ? v : undefined;
    };
    const key = this.config.portal.apiKey;
    const sent = header('x-portal-key');
    const trusted =
      key !== undefined &&
      sent !== undefined &&
      sent.length === key.length &&
      timingSafeEqual(Buffer.from(sent), Buffer.from(key));
    const ip =
      (trusted ? header('x-portal-client-ip') : undefined) ??
      header('x-real-ip') ??
      req.ip ??
      undefined;
    const userAgent = (trusted ? header('x-portal-user-agent') : undefined) ?? header('user-agent');
    return {
      ...(ip ? { ip: ip.slice(0, 64) } : {}),
      ...(userAgent ? { userAgent } : {}),
    };
  }
}
