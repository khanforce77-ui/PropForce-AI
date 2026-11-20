import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { HealthStatus } from '@propforce/contracts';
import type { PrismaClient } from '@propforce/db';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/env';
import { PRISMA } from '../database/database.module';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /** Liveness: the process is running. */
  @Get('live')
  live(): HealthStatus {
    return { status: 'ok', service: 'api', version: this.config.version, checks: {} };
  }

  /** Readiness: dependencies reachable. Redis is reported as skipped until queues are added. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    let database: 'up' | 'down' = 'up';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      database = 'down';
    }
    if (database === 'down') res.status(503);
    return {
      status: database === 'up' ? 'ok' : 'error',
      service: 'api',
      version: this.config.version,
      checks: { database, redis: 'skipped' },
    };
  }
}
