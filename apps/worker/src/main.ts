import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { loadWorkerConfig } from './env';
import { WorkerModule } from './worker.module';

async function main(): Promise<void> {
  const config = loadWorkerConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker started (no queue processors registered yet)');
}

void main();
