import { describe, expect, it } from 'vitest';
import { initials } from '../components/agent-avatar';

describe('initials', () => {
  it('uses first and last name', () => {
    expect(initials('Sara Ahmed Khan')).toBe('SK');
    expect(initials(' omar ')).toBe('O');
    expect(initials('')).toBe('?');
  });
});
