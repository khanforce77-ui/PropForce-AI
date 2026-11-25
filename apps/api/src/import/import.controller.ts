import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard } from '../auth/auth.guard';
import { parseBody } from '../common/zod';
import {
  CurrentTenant,
  RequirePermission,
  TenantGuard,
  type TenantRequestContext,
} from '../tenancy/tenant.guard';
import { ImportService } from './import.service';

/** Rows as parsed from the CSV in the browser: header → cell text. */
const importSchema = z.strictObject({
  dryRun: z.boolean().default(true),
  rows: z
    .array(z.record(z.string().max(80), z.string().max(10_000).nullable()))
    .min(1)
    .max(500),
});

@Controller('import')
@UseGuards(AuthGuard, TenantGuard)
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  @Post('contacts')
  @HttpCode(200)
  @RequirePermission('crm:write')
  contacts(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    const { rows, dryRun } = parseBody(importSchema, body);
    return this.imports.contacts(ctx, rows, dryRun);
  }

  @Post('listings')
  @HttpCode(200)
  @RequirePermission('property:write')
  listings(@CurrentTenant() ctx: TenantRequestContext, @Body() body: unknown) {
    const { rows, dryRun } = parseBody(importSchema, body);
    return this.imports.listings(ctx, rows, dryRun);
  }
}
