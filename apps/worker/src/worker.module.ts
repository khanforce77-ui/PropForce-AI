import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { WORKER_CONFIG, type WorkerConfig } from './env';

/**
 * Root module for background processing. Queue processors (inbound messages, imports,
 * embeddings, ...) are registered here as their modules are built. None exist yet.
 */
@Module({})
export class WorkerModule {
  static forRoot(config: WorkerConfig): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: { level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL },
        }),
      ],
      providers: [{ provide: WORKER_CONFIG, useValue: config }],
      exports: [WORKER_CONFIG],
    };
  }
}
