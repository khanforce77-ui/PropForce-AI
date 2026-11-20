import { Controller, Get, Inject } from '@nestjs/common';
import type { HealthStatus } from '@propforce/contracts';
import { APP_CONFIG, type AppConfig } from '../config/env';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Liveness: the process is running. */
  @Get('live')
  live(): HealthStatus {
    return { status: 'ok', service: 'api', version: this.config.version, checks: {} };
  }

  /**
   * Readiness. Database and Redis checks are added when those modules land (PR 2);
   * until then they are reported as "skipped", not as "up".
   */
  @Get('ready')
  ready(): HealthStatus {
    return {
      status: 'ok',
      service: 'api',
      version: this.config.version,
      checks: { database: 'skipped', redis: 'skipped' },
    };
  }
}
