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

  /**
   * Meta app for WhatsApp (PropForce as Tech Provider). Each agency connects its own number via
   * Embedded Signup; these are the platform app's credentials, not an agency's.
   */
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** Shared secret Vapi sends with server webhooks (Bearer token or X-Vapi-Secret). */
  VAPI_WEBHOOK_SECRET: z.string().min(16).optional(),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  /**
   * Optional never-expiring system user token of the business that owns the Meta app. Lets a
   * platform admin attach a number from that (verified) business directly, without the popup.
   */
  META_SYSTEM_USER_TOKEN: z.string().min(20).optional(),
  META_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v21.0'),
  /** `fake` records sends in memory (development/test only). Default: fake locally, meta when deployed. */
  WHATSAPP_PROVIDER: z.enum(['meta', 'fake']).optional(),
  /**
   * AI replies on WhatsApp. `fake` uses a scripted model (development/test only). Default: fake
   * locally, openai when deployed with OPENAI_API_KEY, otherwise off (agents reply by hand).
   */
  AI_PROVIDER: z.enum(['openai', 'fake', 'none']).optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().min(1).max(100).default('gpt-4.1-mini'),
  /** Per-agency AI token cap per calendar month (input + output). */
  AI_MONTHLY_TOKEN_CAP: z.coerce.number().int().min(0).default(2_000_000),
  /** Public URL of the property portal website (apps/portal), used in WhatsApp messages. */
  PORTAL_PUBLIC_URL: z.url().default('http://localhost:3100'),
  /**
   * Shared secret the portal's server sends so the API can trust the visitor IP it forwards
   * (used only for rate limiting). Without it, the API uses the connecting IP.
   */
  PORTAL_API_KEY: z.string().min(32).optional(),
  /**
   * Cloudflare Turnstile secret. When set, portal enquiries and listing reports must carry a
   * valid captcha token; when unset (pending keys), the honeypot and rate limits still apply.
   */
  TURNSTILE_SECRET_KEY: z.string().min(10).optional(),
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
  portal: { publicUrl: string; apiKey?: string; turnstileSecret?: string };
  /** Undefined only in development/test, where a fixed, clearly non-secret key is used. */
  dataEncryptionKey?: Buffer;
  /** Cookies are Secure everywhere except local development and tests over plain HTTP. */
  secureCookies: boolean;
  whatsapp: {
    /** `none`: not configured, WhatsApp endpoints answer INTEGRATION_NOT_CONFIGURED. */
    provider: 'meta' | 'fake' | 'none';
    appId?: string;
    appSecret?: string;
    verifyToken?: string;
    systemUserToken?: string;
    graphVersion: string;
  };
  /** Voice provider (Vapi) webhooks. Without a secret the webhook refuses every call. */
  voice: { webhookSecret?: string };
  ai: {
    /** `none`: AI replies are off; conversations wait for an agent. */
    provider: 'openai' | 'fake' | 'none';
    openaiApiKey?: string;
    model: string;
    monthlyTokenCap: number;
  };
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
  if (deployed && e.WHATSAPP_PROVIDER === 'fake') {
    throw new Error(
      'Invalid environment configuration: WHATSAPP_PROVIDER=fake is not allowed in staging/production',
    );
  }
  if (deployed && e.AI_PROVIDER === 'fake') {
    throw new Error(
      'Invalid environment configuration: AI_PROVIDER=fake is not allowed in staging/production',
    );
  }
  if (e.AI_PROVIDER === 'openai' && !e.OPENAI_API_KEY) {
    throw new Error('Invalid environment configuration: AI_PROVIDER=openai needs OPENAI_API_KEY');
  }
  const aiProvider = e.AI_PROVIDER ?? (!deployed ? 'fake' : e.OPENAI_API_KEY ? 'openai' : 'none');
  const metaConfigured = Boolean(e.META_APP_ID && e.META_APP_SECRET);
  const waProvider =
    e.WHATSAPP_PROVIDER === 'fake' || (!e.WHATSAPP_PROVIDER && !deployed)
      ? 'fake'
      : metaConfigured
        ? 'meta'
        : 'none';
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
      ...(e.TURNSTILE_SECRET_KEY ? { turnstileSecret: e.TURNSTILE_SECRET_KEY } : {}),
    },
    ...(encryptionKey ? { dataEncryptionKey: encryptionKey } : {}),
    secureCookies: deployed,
    whatsapp: {
      provider: waProvider,
      ...(e.META_APP_ID ? { appId: e.META_APP_ID } : {}),
      ...(e.META_APP_SECRET ? { appSecret: e.META_APP_SECRET } : {}),
      ...(e.META_WEBHOOK_VERIFY_TOKEN ? { verifyToken: e.META_WEBHOOK_VERIFY_TOKEN } : {}),
      ...(e.META_SYSTEM_USER_TOKEN ? { systemUserToken: e.META_SYSTEM_USER_TOKEN } : {}),
      graphVersion: e.META_GRAPH_VERSION,
    },
    voice: { ...(e.VAPI_WEBHOOK_SECRET ? { webhookSecret: e.VAPI_WEBHOOK_SECRET } : {}) },
    ai: {
      provider: aiProvider,
      ...(e.OPENAI_API_KEY ? { openaiApiKey: e.OPENAI_API_KEY } : {}),
      model: e.OPENAI_MODEL,
      monthlyTokenCap: e.AI_MONTHLY_TOKEN_CAP,
    },
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
