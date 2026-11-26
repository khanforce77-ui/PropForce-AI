import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

const KEY = Buffer.alloc(32, 7).toString('base64');

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c.port).toBe(4000);
    expect(c.supportedEmirates).toEqual(['Dubai', 'Abu Dhabi']);
    expect(c.corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('reads supported emirates from configuration', () => {
    expect(loadConfig({ SUPPORTED_EMIRATES: 'Dubai' }).supportedEmirates).toEqual(['Dubai']);
  });

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ API_PORT: 'abc' })).toThrow('Invalid environment configuration');
    expect(() => loadConfig({ SUPPORTED_EMIRATES: 'Dubay' })).toThrow('Unknown emirate');
  });

  it('requires JWT keys and SMTP outside development and test', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', SMTP_URL: 'smtp://x' })).toThrow('JWT keys');
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: 'a',
        JWT_PUBLIC_KEY: 'b',
        SMTP_URL: 'smtp://x',
      }),
    ).toThrow('DATA_ENCRYPTION_KEY');
    expect(() => loadConfig({ DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(
      '32 bytes',
    );
    expect(() =>
      loadConfig({
        NODE_ENV: 'staging',
        JWT_PRIVATE_KEY: 'a',
        JWT_PUBLIC_KEY: 'b',
        DATA_ENCRYPTION_KEY: KEY,
      }),
    ).toThrow('SMTP_URL or RESEND_API_KEY');
  });

  it('accepts a Resend key instead of SMTP', () => {
    const c = loadConfig({
      NODE_ENV: 'staging',
      JWT_PRIVATE_KEY: 'a',
      JWT_PUBLIC_KEY: 'b',
      DATA_ENCRYPTION_KEY: KEY,
      RESEND_API_KEY: 're_test',
    });
    expect(c.email.resendApiKey).toBe('re_test');
  });

  it('uses Secure cookies only when deployed', () => {
    expect(loadConfig({}).secureCookies).toBe(false);
    expect(
      loadConfig({
        NODE_ENV: 'production',
        JWT_PRIVATE_KEY: 'a',
        JWT_PUBLIC_KEY: 'b',
        SMTP_URL: 'smtp://x',
        DATA_ENCRYPTION_KEY: KEY,
      }).secureCookies,
    ).toBe(true);
  });

  it('chooses the WhatsApp provider safely', () => {
    const deployed = {
      NODE_ENV: 'production',
      JWT_PRIVATE_KEY: 'a',
      JWT_PUBLIC_KEY: 'b',
      SMTP_URL: 'smtp://x',
      DATA_ENCRYPTION_KEY: KEY,
    };
    expect(loadConfig({}).whatsapp.provider).toBe('fake');
    expect(loadConfig(deployed).whatsapp.provider).toBe('none');
    expect(
      loadConfig({ ...deployed, META_APP_ID: '1', META_APP_SECRET: 's' }).whatsapp.provider,
    ).toBe('meta');
    expect(() => loadConfig({ ...deployed, WHATSAPP_PROVIDER: 'fake' })).toThrow(
      'WHATSAPP_PROVIDER',
    );
    expect(() => loadConfig({ META_GRAPH_VERSION: 'latest' })).toThrow();
  });
});
