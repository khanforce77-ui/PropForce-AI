import { parseEmirateList, type Emirate } from '@propforce/contracts';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SUPPORTED_EMIRATES: z.string().default('Dubai,Abu Dhabi'),
  APP_VERSION: z.string().default('0.0.0'),
});

export interface AppConfig {
  nodeEnv: z.infer<typeof envSchema>['NODE_ENV'];
  port: number;
  corsOrigins: string[];
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  supportedEmirates: Emirate[];
  version: string;
}

/** Validates process environment once at boot. Invalid config stops the process. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    corsOrigins: e.API_CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    supportedEmirates: parseEmirateList(e.SUPPORTED_EMIRATES),
    version: e.APP_VERSION,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
