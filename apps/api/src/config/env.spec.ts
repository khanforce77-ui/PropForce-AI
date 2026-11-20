import { describe, expect, it } from 'vitest';
import { loadConfig } from './env';

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
});
