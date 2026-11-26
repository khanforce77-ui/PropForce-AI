import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import { PlatformAdminGuard } from './platform.guard';
import { TrustService } from './trust.service';

const uuid = () => new ParseUUIDPipe();
const reviewQuery = z.strictObject({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
const listingDecision = z.strictObject({
  decision: z.enum(['approve', 'reject', 'send_back']),
  reason: z.string().trim().min(3).max(500).optional(),
});
const brokerDecision = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(3).max(500).optional(),
});

function sendPrivateFile(res: Response, contentType: string, bytes: Uint8Array, name: string) {
  res.set({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename="${name.replace(/[^\w.\- ]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.send(Buffer.from(bytes));
}

/** Listing review queue and broker verification, for platform admins (flag + two-factor). */
@Controller('platform')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class TrustController {
  constructor(private readonly trust: TrustService) {}

  @Get('listing-reviews')
  async listingReviews(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { status } = parseBody(reviewQuery, query);
    return { data: await this.trust.listingReviews(req.auth.userId, status) };
  }

  @Post('listings/:id/review')
  @HttpCode(200)
  decideListing(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    const { decision, reason } = parseBody(listingDecision, body);
    return this.trust.decideListing(req.auth.userId, id, decision, reason);
  }

  @Get('listings/:id/permits/:permitId/document')
  async permitDocument(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Param('permitId', uuid()) permitId: string,
    @Res() res: Response,
  ) {
    const doc = await this.trust.permitDocument(req.auth.userId, id, permitId);
    sendPrivateFile(res, doc.contentType, doc.bytes, doc.fileName);
  }

  @Get('broker-verifications')
  async brokerVerifications(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { status } = parseBody(reviewQuery, query);
    return { data: await this.trust.brokerVerifications(req.auth.userId, status) };
  }

  @Get('broker-verifications/:id/card')
  async card(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    const doc = await this.trust.brokerDocument(req.auth.userId, id, 'card');
    sendPrivateFile(res, doc.contentType, doc.bytes, 'broker-card');
  }

  @Get('broker-verifications/:id/emirates-id')
  async emiratesId(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    const doc = await this.trust.brokerDocument(req.auth.userId, id, 'emirates_id');
    sendPrivateFile(res, doc.contentType, doc.bytes, 'emirates-id');
  }

  @Post('broker-verifications/:id/decision')
  @HttpCode(200)
  decideBroker(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    const { decision, reason } = parseBody(brokerDecision, body);
    return this.trust.decideBroker(req.auth.userId, id, decision, reason);
  }
}
