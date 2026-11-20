import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import type { AppConfig } from './config/env';

/** Builds the Nest app with the same middleware in production and tests. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}
