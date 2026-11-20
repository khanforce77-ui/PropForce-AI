import 'reflect-metadata';
// Vercel's NestJS builder looks for an entrypoint that imports @nestjs/core directly.
import '@nestjs/core';
import { createApp } from './bootstrap';
import { loadConfig } from './config/env';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await createApp(config);
  await app.listen(config.port);
}

void main();
