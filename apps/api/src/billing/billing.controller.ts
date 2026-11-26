import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import { PlatformAdminGuard } from '../platform/platform.guard';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import {
  capsSchema,
  checkoutSchema,
  planUpdateSchema,
  subscriptionSetSchema,
} from './billing.schemas';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(AuthGuard, TenantGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @RequirePermission('billing:read')
  overview(@CurrentTenant() ctx: TenantRequestContext) {
    return this.billing.overview(ctx);
  }

  @Post('checkout')
  @HttpCode(200)
  @RequirePermission('billing:manage')
  checkout(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.billing.checkout(ctx, parseBody(checkoutSchema, body).planCode);
  }

  @Put('spending-caps')
  @RequirePermission('billing:manage')
  caps(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.billing.setCaps(ctx, parseBody(capsSchema, body));
  }
}

@Controller('platform/billing')
@UseGuards(AuthGuard, PlatformAdminGuard)
export class PlatformBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  overview(@Req() req: AuthenticatedRequest) {
    return this.billing.platformOverview(req.auth.userId);
  }

  @Get('usage')
  usage(@Req() req: AuthenticatedRequest) {
    return this.billing.platformUsage(req.auth.userId);
  }

  @Put('plans/:code')
  updatePlan(@Req() req: AuthenticatedRequest, @Param('code') code: string, @Body() body: unknown) {
    return this.billing.updatePlan(req.auth.userId, code, parseBody(planUpdateSchema, body));
  }

  @Put('agencies/:id/subscription')
  setSubscription(
    @Req() req: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    return this.billing.setSubscription(
      req.auth.userId,
      id,
      parseBody(subscriptionSetSchema, body),
    );
  }
}
