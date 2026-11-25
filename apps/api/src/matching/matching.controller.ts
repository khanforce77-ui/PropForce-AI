import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { MatchingService } from './matching.service';

const uuid = () => new ParseUUIDPipe();
const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

@Controller()
@UseGuards(AuthGuard, TenantGuard)
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get('leads/:id/matches')
  @RequirePermission('crm:read')
  forLead(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Query() query: unknown,
  ) {
    return this.matching.listingsForLead(ctx, id, parseBody(limitSchema, query).limit);
  }

  @Post('leads/:id/matches/:propertyId/suggested')
  @RequirePermission('crm:write')
  suggested(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Param('propertyId', uuid()) propertyId: string,
  ) {
    return this.matching.markSuggested(ctx, id, propertyId);
  }

  @Get('properties/:id/matches')
  @RequirePermission('crm:read')
  forListing(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Query() query: unknown,
  ) {
    return this.matching.leadsForListing(ctx, id, parseBody(limitSchema, query).limit);
  }
}
