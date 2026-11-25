import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { BrokerVerificationService } from './broker-verification.service';

const uuid = () => new ParseUUIDPipe();
const submitSchema = z.strictObject({
  /** DLD Broker Registration Number, as on the broker card. */
  brn: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{3,32}$/, 'Enter the BRN as printed on the broker card'),
  brnExpiresAt: z.iso.date(),
  card: z.string().max(1_000_000),
  emiratesId: z.string().max(1_000_000),
});

/** An agent's "Verified agent" request: their broker card and Emirates ID, checked by PropForce. */
@Controller('portal/agents/:id/verification')
@UseGuards(AuthGuard, TenantGuard)
export class BrokerVerificationController {
  constructor(private readonly verification: BrokerVerificationService) {}

  @Get()
  @RequirePermission('property:read')
  get(@CurrentTenant() ctx: TenantRequestContext, @Param('id', uuid()) id: string) {
    return this.verification.get(ctx, id);
  }

  @Post()
  @RequirePermission('property:write')
  submit(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.verification.submit(ctx, id, parseBody(submitSchema, body));
  }
}
