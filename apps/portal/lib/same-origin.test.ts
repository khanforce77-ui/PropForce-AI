import { describe, expect, it } from 'vitest';
import { isSameOrigin } from './same-origin';

describe('isSameOrigin', () => {
  it('accepts only the same host', () => {
    expect(isSameOrigin('https://homes.example', 'homes.example')).toBe(true);
    expect(isSameOrigin('https://evil.example', 'homes.example')).toBe(false);
    expect(isSameOrigin(null, 'homes.example')).toBe(false);
    expect(isSameOrigin('not a url', 'homes.example')).toBe(false);
  });
});
