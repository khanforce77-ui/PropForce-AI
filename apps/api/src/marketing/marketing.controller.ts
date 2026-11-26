import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import {
  attributionSchema,
  captionCreateSchema,
  captionListSchema,
  captionUpdateSchema,
} from './marketing.schemas';
import { MarketingService } from './marketing.service';

const uuid = () => new ParseUUIDPipe();

@Controller('marketing')
@UseGuards(AuthGuard, TenantGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Get('captions')
  @RequirePermission('property:read')
  captions(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.marketing.listCaptions(ctx, parseBody(captionListSchema, q));
  }

  @Post('captions')
  @RequirePermission('property:write')
  createCaption(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    return this.marketing.createCaption(ctx, parseBody(captionCreateSchema, body));
  }

  @Patch('captions/:id')
  @RequirePermission('property:write')
  updateCaption(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('id', uuid()) id: string,
    @Body() body: unknown,
  ) {
    return this.marketing.updateCaption(ctx, id, parseBody(captionUpdateSchema, body));
  }

  @Get('brochure/:propertyId')
  @RequirePermission('property:read')
  brochure(
    @CurrentTenant() ctx: TenantRequestContext,
    @Param('propertyId', uuid()) propertyId: string,
  ) {
    return this.marketing.brochure(ctx, propertyId);
  }

  @Get('attribution')
  @RequirePermission('crm:manage')
  attribution(@CurrentTenant() ctx: TenantRequestContext, @Query() q: unknown) {
    return this.marketing.attribution(ctx, parseBody(attributionSchema, q));
  }
}
