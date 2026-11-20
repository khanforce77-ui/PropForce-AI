import { parseEmirateList, type Emirate } from '@propforce/contracts';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_CORS_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SUPPORTED_EMIRATES: z.string().default('Dubai,Abu Dhabi'),
  APP_VERSION: z.string().default('0.0.0'),
  /** Public URL of the web app, used in email links. */
  APP_WEB_URL: z.url().default('http://localhost:3000'),

  DATABASE_URL: z
    .string()
    .default('postgresql://propforce_app_user:propforce_app_dev_only@localhost:5432/propforce'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

  /** Ed25519 keys (PKCS8 / SPKI PEM). Required outside development and test. */
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_ISSUER: z.string().default('propforce-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),

  /** SMTP connection URL, e.g. smtp://localhost:1025 for Mailpit. Empty = log emails instead. */
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default('PropForce AI <no-reply@propforce.local>'),

  /**
   * 32-byte key (base64) for encrypting secrets at rest (TOTP seeds, later OAuth tokens).
   * Required outside development and test. In production this comes from the secrets manager.
   */
  DATA_ENCRYPTION_KEY: z.string().optional(),

  /** Requests per minute for sensitive auth endpoints, per client IP. */
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),

  /** Public URL of the property portal website (apps/portal), used in WhatsApp messages. */
  PORTAL_PUBLIC_URL: z.url().default('http://localhost:3100'),
  /**
   * Shared secret the portal's server sends so the API can trust the visitor IP it forwards
   * (used only for rate limiting). Without it, the API uses the connecting IP.
   */
  PORTAL_API_KEY: z.string().min(32).optional(),
});

export interface AppConfig {
  nodeEnv: z.infer<typeof envSchema>['NODE_ENV'];
  port: number;
  corsOrigins: string[];
  logLevel: z.infer<typeof envSchema>['LOG_LEVEL'];
  supportedEmirates: Emirate[];
  version: string;
  webUrl: string;
  database: { url: string; poolMax: number };
  jwt: {
    privateKeyPem?: string;
    publicKeyPem?: string;
    issuer: string;
    accessTtlSeconds: number;
  };
  refreshTokenTtlDays: number;
  email: { smtpUrl?: string; from: string };
  authRateLimitPerMinute: number;
  portal: { publicUrl: string; apiKey?: string };
  /** Undefined only in development/test, where a fixed, clearly non-secret key is used. */
  dataEncryptionKey?: Buffer;
  /** Cookies are Secure everywhere except local development and tests over plain HTTP. */
  secureCookies: boolean;
}

/** Validates process environment once at boot. Invalid config stops the process. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const e = parsed.data;
  const deployed = e.NODE_ENV === 'staging' || e.NODE_ENV === 'production';
  if (deployed && (!e.JWT_PRIVATE_KEY || !e.JWT_PUBLIC_KEY)) {
    throw new Error(
      'Invalid environment configuration: JWT keys are required in staging/production',
    );
  }
  const encryptionKey = e.DATA_ENCRYPTION_KEY
    ? Buffer.from(e.DATA_ENCRYPTION_KEY, 'base64')
    : undefined;
  if (encryptionKey && encryptionKey.length !== 32) {
    throw new Error(
      'Invalid environment configuration: DATA_ENCRYPTION_KEY must be 32 bytes (base64)',
    );
  }
  if (deployed && !encryptionKey) {
    throw new Error(
      'Invalid environment configuration: DATA_ENCRYPTION_KEY is required in staging/production',
    );
  }
  if (deployed && !e.SMTP_URL) {
    throw new Error(
      'Invalid environment configuration: SMTP_URL is required in staging/production',
    );
  }
  return {
    nodeEnv: e.NODE_ENV,
    port: e.API_PORT,
    corsOrigins: e.API_CORS_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: e.LOG_LEVEL,
    supportedEmirates: parseEmirateList(e.SUPPORTED_EMIRATES),
    version: e.APP_VERSION,
    webUrl: e.APP_WEB_URL.replace(/\/$/, ''),
    database: { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX },
    jwt: {
      ...(e.JWT_PRIVATE_KEY ? { privateKeyPem: e.JWT_PRIVATE_KEY.replace(/\\n/g, '\n') } : {}),
      ...(e.JWT_PUBLIC_KEY ? { publicKeyPem: e.JWT_PUBLIC_KEY.replace(/\\n/g, '\n') } : {}),
      issuer: e.JWT_ISSUER,
      accessTtlSeconds: e.ACCESS_TOKEN_TTL_SECONDS,
    },
    refreshTokenTtlDays: e.REFRESH_TOKEN_TTL_DAYS,
    email: { ...(e.SMTP_URL ? { smtpUrl: e.SMTP_URL } : {}), from: e.EMAIL_FROM },
    authRateLimitPerMinute: e.AUTH_RATE_LIMIT_PER_MINUTE,
    portal: {
      publicUrl: e.PORTAL_PUBLIC_URL.replace(/\/$/, ''),
      ...(e.PORTAL_API_KEY ? { apiKey: e.PORTAL_API_KEY } : {}),
    },
    ...(encryptionKey ? { dataEncryptionKey: encryptionKey } : {}),
    secureCookies: deployed,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
