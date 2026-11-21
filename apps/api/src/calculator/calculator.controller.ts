import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { emirateSchema } from '@propforce/contracts';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { estimateSchema, ruleOverrideSchema, rulesQuery } from './calculator.schemas';
import { CalculatorService } from './calculator.service';

/** UAE cost calculator for agents: fees, mortgage and commission. Outputs are estimates. */
@Controller('calculator')
@UseGuards(AuthGuard, TenantGuard)
export class CalculatorController {
  constructor(private readonly calc: CalculatorService) {}

  @Get('rules')
  @RequirePermission('property:read')
  rules(@CurrentTenant() ctx: TenantRequestContext, @Query() query: unknown) {
    return this.calc.rules(ctx, parseBody(rulesQuery, query).emirate);
  }

  @Post('estimate')
  @HttpCode(200)
  @RequirePermission('property:read')
  estimate(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.calc.estimate(ctx, parseBody(estimateSchema, body));
  }

  @Put('rules')
  @RequirePermission('agency:settings')
  setRule(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.calc.setOverride(ctx, parseBody(ruleOverrideSchema, body));
  }

  @Delete('rules/:emirate/:code')
  @HttpCode(204)
  @RequirePermission('agency:settings')
  async resetRule(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('emirate') emirate: string,
    @Param('code') code: string,
  ) {
    await this.calc.removeOverride(ctx, emirateSchema.parse(emirate), code.slice(0, 60));
  }
}
