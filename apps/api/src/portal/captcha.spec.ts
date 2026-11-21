import { describe, expect, it, vi } from 'vitest';
import { verifyCaptcha } from './captcha';

const reply = (body: unknown, ok = true) =>
  vi.fn(async () => ({ ok, json: async () => body }) as Response);

describe('verifyCaptcha', () => {
  it('is skipped when no secret is configured', async () => {
    const f = reply({ success: true });
    expect(await verifyCaptcha(undefined, 'tok', '1.2.3.4', f)).toBe('not_configured');
    expect(f).not.toHaveBeenCalled();
  });

  it('fails without a token when configured', async () => {
    expect(await verifyCaptcha('secret-value', undefined, undefined, reply({}))).toBe('failed');
  });

  it('passes on success and sends the secret, token and IP', async () => {
    const f = reply({ success: true });
    expect(await verifyCaptcha('secret-value', 'tok', '1.2.3.4', f)).toBe('ok');
    const body = (f.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
    expect(body.get('secret')).toBe('secret-value');
    expect(body.get('response')).toBe('tok');
    expect(body.get('remoteip')).toBe('1.2.3.4');
  });

  it('fails closed on a rejected token or a network error', async () => {
    expect(await verifyCaptcha('secret-value', 'tok', undefined, reply({ success: false }))).toBe(
      'failed',
    );
    const broken = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await verifyCaptcha('secret-value', 'tok', undefined, broken)).toBe('failed');
  });
});
