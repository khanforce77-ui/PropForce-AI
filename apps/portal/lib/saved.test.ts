import { describe, expect, it } from 'vitest';
import { parseSaved, toggleSaved } from './saved';

const a = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const b = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe('saved listings', () => {
  it('keeps only listing ids from storage', () => {
    expect(parseSaved(JSON.stringify([a, 'x', 3, b]))).toEqual([a, b]);
    expect(parseSaved('not json')).toEqual([]);
    expect(parseSaved('{"a":1}')).toEqual([]);
  });

  it('adds newest first and removes on a second toggle', () => {
    expect(toggleSaved([a], b)).toEqual([b, a]);
    expect(toggleSaved([b, a], b)).toEqual([a]);
  });
});
