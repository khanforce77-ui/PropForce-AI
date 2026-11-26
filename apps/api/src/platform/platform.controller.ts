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
  Req,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import { PlatformAdminGuard } from './platform.guard';
import { PlatformService } from './platform.service';
import {
  agencyCreateSchema,
  agencyDetailsSchema,
  agencyInviteSchema,
} from './site-content.schemas';

const reasonSchema = z.strictObject({ reason: z.string().trim().min(3).max(500) });
const planSchema = z
  .strictObject({
    plan: z.string().trim().min(1).max(40).optional(),
    seatLimit: z.number().int().min(1).max(10_000).nullable().optional(),
    listingLimit: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
const flagSchema = z.strictObject({ enabled: z.boolean() });
const dashboardQuery = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});
const listingReportsQuery = z.strictObject({
  status: z.enum(['open', 'resolved', 'dismissed']).optional(),
});
const listingsQuery = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(['draft', 'active', 'under_offer', 'sold', 'rented', 'archived']).optional(),
});
const usersQuery = z.object({ q: z.string().trim().min(1).max(80).optional() });
const uuid = () => new ParseUUIDPipe();

/** Platform administration. Every route needs the platform-admin flag and two-factor. */
@Controller('platform')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('summary')
  summary(@Req() req: AuthenticatedRequest) {
    return this.platform.summary(req.auth.userId);
  }

  @Get('agencies')
  async agencies(@Req() req: AuthenticatedRequest) {
    return { data: await this.platform.agencies(req.auth.userId) };
  }

  /** Creates an agency by hand, optionally inviting its owner by email. */
  @Post('agencies')
  createAgency(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    return this.platform.createAgency(req.auth.userId, parseBody(agencyCreateSchema, body));
  }

  @Post('agencies/:id/invitations')
  invite(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string, @Body() body: unknown) {
    const { email, role } = parseBody(agencyInviteSchema, body);
    return this.platform.inviteToAgency(req.auth.userId, id, email, role);
  }

  @Patch('agencies/:id/details')
  updateDetails(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.platform.updateAgencyDetails(
      req.auth.userId,
      id,
      parseBody(agencyDetailsSchema, body),
    );
  }

  @Post('agencies/:id/approve')
  @HttpCode(200)
  approve(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    return this.platform.approveAgency(req.auth.userId, id);
  }

  @Post('agencies/:id/reject')
  @HttpCode(200)
  reject(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string, @Body() body: unknown) {
    return this.platform.rejectAgency(req.auth.userId, id, parseBody(reasonSchema, body).reason);
  }

  @Post('agencies/:id/suspend')
  @HttpCode(200)
  suspendAgency(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.platform.suspendAgency(req.auth.userId, id, parseBody(reasonSchema, body).reason);
  }

  @Post('agencies/:id/reactivate')
  @HttpCode(200)
  reactivateAgency(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    return this.platform.reactivateAgency(req.auth.userId, id);
  }

  @Patch('agencies/:id')
  updatePlan(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.platform.updateAgencyPlan(req.auth.userId, id, parseBody(planSchema, body));
  }

  @Get('users')
  async users(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return {
      data: await this.platform.recentUsers(req.auth.userId, parseBody(usersQuery, query).q),
    };
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  suspendUser(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.platform.suspendUser(req.auth.userId, id, parseBody(reasonSchema, body).reason);
  }

  @Post('users/:id/reactivate')
  @HttpCode(200)
  reactivateUser(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    return this.platform.reactivateUser(req.auth.userId, id);
  }

  @Get('dashboard')
  dashboard(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return this.platform.dashboard(req.auth.userId, parseBody(dashboardQuery, query).days);
  }

  @Get('listing-reports')
  async listingReports(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { status } = parseBody(listingReportsQuery, query);
    return { data: await this.platform.listingReports(req.auth.userId, status) };
  }

  @Get('listings')
  async listings(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    return { data: await this.platform.listings(req.auth.userId, parseBody(listingsQuery, query)) };
  }

  /** Opens (creating on first use) the platform's own agency, PropForce Direct. */
  @Post('direct')
  @HttpCode(200)
  direct(@Req() req: AuthenticatedRequest) {
    return this.platform.direct(req.auth.userId);
  }

  @Get('settings')
  async settings() {
    return { data: await this.platform.listFlags() };
  }

  @Patch('settings/:key')
  setSetting(@Req() req: AuthenticatedRequest, @Param('key') key: string, @Body() body: unknown) {
    if (!/^[a-z0-9_.]{1,80}$/.test(key)) {
      return this.platform.setFlag(req.auth.userId, '__invalid__', false);
    }
    return this.platform.setFlag(req.auth.userId, key, parseBody(flagSchema, body).enabled);
  }

  @Get('audit-log')
  async auditLog() {
    return { data: await this.platform.auditLog() };
  }
}
