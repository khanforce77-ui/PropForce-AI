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
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { AppError } from '../common/app-error';
import { parseBody } from '../common/zod';
import { PlatformAdminGuard } from '../platform/platform.guard';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { AGENCY_DOCUMENT_TYPES } from './kyc-rules';
import { KycService } from './kyc.service';

const uuid = () => new ParseUUIDPipe();
const optional = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const ownerSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(120),
  nationality: optional(60),
  sharePercent: z.number().int().min(0).max(100).nullable().optional(),
  uaeResident: z.boolean().optional(),
});
const employeeSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(120),
  designation: optional(80),
  isBroker: z.boolean().optional(),
  brn: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,32}$/, 'Enter the BRN as printed on the broker card')
    .nullable()
    .optional(),
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()).nullable().optional(),
});
const uploadQuery = z.strictObject({
  type: z.enum(AGENCY_DOCUMENT_TYPES),
  ownerId: z.uuid().optional(),
  employeeId: z.uuid().optional(),
  expiresAt: z.iso.date().optional(),
  documentNumber: z.string().trim().min(1).max(64).optional(),
  label: z.string().trim().min(2).max(120).optional(),
  fileName: z.string().trim().min(1).max(200).default('document'),
});
const queueQuery = z.strictObject({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
});
const decisionSchema = z.strictObject({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(3).max(500).optional(),
});
const instructionsSchema = z.strictObject({ text: z.string().max(4000) });
const checkAllSchema = z.strictObject({ force: z.boolean().optional() });

export function sendPrivateFile(
  res: Response,
  doc: { contentType: string; bytes: Uint8Array; fileName: string },
) {
  res.set({
    'Content-Type': doc.contentType,
    'Content-Disposition': `inline; filename="${doc.fileName.replace(/[^\w.\- ]/g, '_')}"`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  res.send(Buffer.from(doc.bytes));
}

/**
 * The agency's registration documents (KYC). Owners and admins only (`agency:write`): the files
 * include owners' passports and Emirates IDs, so agents and managers cannot see them.
 */
@Controller('agency/kyc')
@UseGuards(AuthGuard, TenantGuard)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  @Get()
  @RequirePermission('agency:write')
  get(@CurrentTenant() ctx: TenantRequestContext) {
    return this.kyc.get(ctx);
  }

  @Post('owners')
  @RequirePermission('agency:write')
  addOwner(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.kyc.addOwner(ctx, parseBody(ownerSchema, body));
  }

  @Patch('owners/:id')
  @RequirePermission('agency:write')
  updateOwner(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.kyc.updateOwner(ctx, id, parseBody(ownerSchema.partial(), body));
  }

  @Delete('owners/:id')
  @HttpCode(204)
  @RequirePermission('agency:write')
  async removeOwner(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    await this.kyc.removeOwner(ctx, id);
  }

  @Post('employees')
  @RequirePermission('agency:write')
  addEmployee(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.kyc.addEmployee(ctx, parseBody(employeeSchema, body));
  }

  @Patch('employees/:id')
  @RequirePermission('agency:write')
  updateEmployee(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.kyc.updateEmployee(ctx, id, parseBody(employeeSchema.partial(), body));
  }

  @Delete('employees/:id')
  @HttpCode(204)
  @RequirePermission('agency:write')
  async removeEmployee(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
  ) {
    await this.kyc.removeEmployee(ctx, id);
  }

  /** The file itself is the raw request body (PDF or image); details go in the query string. */
  @Put('documents')
  @RequirePermission('agency:write')
  upload(
    @CurrentTenant() ctx: TenantRequestContext,
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
    return this.kyc.upload(ctx, parseBody(uploadQuery, query), body);
  }

  @Get('documents/:id/file')
  @RequirePermission('agency:write')
  async file(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    sendPrivateFile(res, await this.kyc.file(ctx, id));
  }

  @Post('documents/:id/check')
  @HttpCode(200)
  @RequirePermission('agency:write')
  check(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.kyc.checkOwn(ctx, id);
  }

  @Delete('documents/:id')
  @HttpCode(204)
  @RequirePermission('agency:write')
  async remove(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    await this.kyc.removeDocument(ctx, id);
  }
}

/** PropForce's review of agencies' registration documents (platform admins with two-factor). */
@Controller('platform')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformKycController {
  constructor(private readonly kyc: KycService) {}

  @Get('agency-documents')
  async queue(@Req() req: AuthenticatedRequest, @Query() query: unknown) {
    const { status } = parseBody(queueQuery, query);
    return { data: await this.kyc.queue(req.auth.userId, status) };
  }

  @Get('agencies/:id/kyc')
  agencyKyc(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    return this.kyc.agencyKyc(req.auth.userId, id);
  }

  @Post('agencies/:id/kyc/check')
  @HttpCode(200)
  checkAll(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    const { force } = parseBody(checkAllSchema, body ?? {});
    return this.kyc.adminCheckAll(req.auth.userId, id, force ?? false);
  }

  @Post('agencies/:id/kyc/approve-clean')
  @HttpCode(200)
  approveClean(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    return this.kyc.approveClean(req.auth.userId, id);
  }

  @Post('agencies/:id/kyc/instructions')
  @HttpCode(200)
  instructions(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.kyc.sendInstructions(req.auth.userId, id, parseBody(instructionsSchema, body).text);
  }

  @Get('agency-documents/:id/file')
  async file(
    @Req() req: AuthenticatedRequest,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    sendPrivateFile(res, await this.kyc.adminFile(req.auth.userId, id));
  }

  @Post('agency-documents/:id/check')
  @HttpCode(200)
  checkOne(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string) {
    return this.kyc.adminCheckOne(req.auth.userId, id);
  }

  @Post('agency-documents/:id/decision')
  @HttpCode(200)
  decide(@Req() req: AuthenticatedRequest, @Param('id', uuid()) id: string, @Body() body: unknown) {
    const { decision, reason } = parseBody(decisionSchema, body);
    return this.kyc.decide(req.auth.userId, id, decision, reason);
  }
}
