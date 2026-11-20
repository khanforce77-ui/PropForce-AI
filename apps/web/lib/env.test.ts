import { describe, expect, it, vi } from 'vitest';
import { getPublicApiUrl } from './env';

describe('getPublicApiUrl', () => {
  it('defaults to the local API', () => {
    expect(getPublicApiUrl({})).toBe('http://localhost:4000');
  });

  it('normalizes to an origin', () => {
    expect(getPublicApiUrl({ NEXT_PUBLIC_API_URL: 'https://api.example.com/v1/' })).toBe(
      'https://api.example.com',
    );
  });

  it('uses the page origin when the API shares the domain', () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example.com' } });
    expect(getPublicApiUrl({ NEXT_PUBLIC_API_URL: 'same-origin' })).toBe('https://app.example.com');
    vi.unstubAllGlobals();
  });

  it('rejects non-http protocols', () => {
    expect(() => getPublicApiUrl({ NEXT_PUBLIC_API_URL: 'javascript:alert(1)' })).toThrow();
  });
});
