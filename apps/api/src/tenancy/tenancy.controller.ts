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
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { parseBody } from '../common/zod';
import { InvitationService } from './invitation.service';
import { TenancyService } from './tenancy.service';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from './tenant.guard';

const role = z.enum(['owner', 'admin', 'manager', 'agent']);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const updateAgencySchema = z.strictObject({
  name: z.string().trim().min(2).max(160).optional(),
  tradeLicenseNo: optionalText(64),
  orn: optionalText(32),
  website: z
    .string()
    .trim()
    .max(200)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .pipe(z.url({ protocol: /^https?$/, hostname: z.regexes.domain }))
    .nullable()
    .optional(),
});
const updateSettingsSchema = z.strictObject({
  listingFreshnessDays: z.number().int().min(1).max(365).optional(),
  branding: z
    .strictObject({
      primaryColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
      logoMediaId: z.uuid().optional(),
    })
    .optional(),
});
const updateMemberSchema = z.strictObject({
  role: role.optional(),
  teamId: z.uuid().nullable().optional(),
});
const teamSchema = z.strictObject({ name: z.string().trim().min(1).max(80) });
const inviteSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  role,
  teamId: z.uuid().optional(),
});
const acceptSchema = z.strictObject({
  token: z.string().min(20).max(200),
  fullName: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(12, 'Use at least 12 characters').max(128).optional(),
});
const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.uuid().optional(),
  action: z.string().max(64).optional(),
  entityType: z.string().max(64).optional(),
});

@Controller()
@UseGuards(AuthGuard, TenantGuard)
export class TenancyController {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly invitations: InvitationService,
  ) {}

  @Get('agency')
  @RequirePermission('agency:read')
  getAgency(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tenancy.getAgency(ctx);
  }

  @Patch('agency')
  @RequirePermission('agency:write')
  updateAgency(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.tenancy.updateAgency(ctx, parseBody(updateAgencySchema, body));
  }

  @Post('agency/onboarding/complete')
  @HttpCode(200)
  @RequirePermission('agency:write')
  completeOnboarding(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tenancy.completeOnboarding(ctx);
  }

  @Get('agency/settings')
  @RequirePermission('agency:settings')
  getSettings(@CurrentTenant() ctx: TenantRequestContext) {
    return this.tenancy.getSettings(ctx);
  }

  @Patch('agency/settings')
  @RequirePermission('agency:settings')
  updateSettings(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.tenancy.updateSettings(ctx, parseBody(updateSettingsSchema, body));
  }

  @Get('members')
  @RequirePermission('member:read')
  async listMembers(@CurrentTenant() ctx: TenantRequestContext) {
    return { data: await this.tenancy.listMembers(ctx) };
  }

  @Patch('members/:id')
  @RequirePermission('member:write')
  updateMember(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.tenancy.updateMember(ctx, id, parseBody(updateMemberSchema, body));
  }

  @Post('members/:id/suspend')
  @HttpCode(200)
  @RequirePermission('member:suspend')
  suspend(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tenancy.setMemberStatus(ctx, id, 'suspended');
  }

  @Post('members/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('member:suspend')
  reactivate(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tenancy.setMemberStatus(ctx, id, 'active');
  }

  @Get('teams')
  @RequirePermission('team:read')
  async listTeams(@CurrentTenant() ctx: TenantRequestContext) {
    return { data: await this.tenancy.listTeams(ctx) };
  }

  @Post('teams')
  @RequirePermission('team:write')
  createTeam(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.tenancy.createTeam(ctx, parseBody(teamSchema, body).name);
  }

  @Patch('teams/:id')
  @RequirePermission('team:write')
  renameTeam(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.tenancy.renameTeam(ctx, id, parseBody(teamSchema, body).name);
  }

  @Delete('teams/:id')
  @HttpCode(204)
  @RequirePermission('team:write')
  async deleteTeam(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.tenancy.deleteTeam(ctx, id);
  }

  @Get('invitations')
  @RequirePermission('member:invite')
  async listInvitations(@CurrentTenant() ctx: TenantRequestContext) {
    return { data: await this.invitations.list(ctx) };
  }

  @Post('invitations')
  @RequirePermission('member:invite')
  invite(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.invitations.create(ctx, parseBody(inviteSchema, body));
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  @RequirePermission('member:invite')
  async revokeInvitation(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.invitations.revoke(ctx, id);
  }

  @Get('audit-logs')
  @RequirePermission('audit:read')
  listAuditLogs(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.tenancy.listAuditLogs(ctx, parseBody(auditQuerySchema, query));
  }
}

/** Public endpoint: accepting an invitation happens before the person has agency context. */
@Controller('invitations')
@UseGuards(ThrottlerGuard)
export class InvitationAcceptController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly auth: AuthService,
  ) {}

  @Post('accept')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async accept(@Body() body: unknown, @Req() req: Request) {
    const input = parseBody(acceptSchema, body);
    const header = req.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const session = bearer ? await this.auth.authenticate(bearer) : null;
    return this.invitations.accept({ ...input, currentUserId: session?.userId });
  }
}
