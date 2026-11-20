import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { loadWorkerConfig, WORKER_CONFIG } from './env';
import { WorkerModule } from './worker.module';

describe('worker', () => {
  it('validates configuration', () => {
    expect(loadWorkerConfig({}).WORKER_CONCURRENCY).toBe(5);
    expect(() => loadWorkerConfig({ REDIS_URL: 'not a url' })).toThrow(
      'Invalid worker configuration',
    );
  });

  it('boots and shuts down the application context', async () => {
    const config = loadWorkerConfig({ NODE_ENV: 'test' });
    const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(config), {
      logger: false,
    });
    expect(app.get(WORKER_CONFIG)).toEqual(config);
    await app.close();
  });
});
