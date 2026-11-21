import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';
import type { AppConfig } from './config/env';

/** Builds the Nest app with the same middleware in production and tests. */
export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    bodyParser: true,
    // Webhook signatures are computed over the exact bytes received.
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  // Photo and logo uploads arrive as raw image bytes. Hosting may cap bodies lower (Vercel: 4.5 MB);
  // the web app shrinks large photos in the browser before sending them.
  app.useBodyParser('raw', {
    type: ['image/*', 'application/pdf', 'application/octet-stream'],
    limit: '15mb',
  });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableShutdownHooks();
  return app;
}
