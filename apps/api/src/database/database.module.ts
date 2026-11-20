import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrismaClient, type PrismaClient } from '@propforce/db';
import { APP_CONFIG, type AppConfig } from '../config/env';

export const PRISMA = Symbol('PRISMA');

@Global()
@Module({
  providers: [
    {
      provide: PRISMA,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PrismaClient =>
        createPrismaClient({ connectionString: config.database.url, max: config.database.poolMax }),
    },
  ],
  exports: [PRISMA],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
