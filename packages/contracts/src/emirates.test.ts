import { describe, expect, it } from 'vitest';
import { parseEmirateList } from './emirates';

describe('parseEmirateList', () => {
  it('parses and trims a comma-separated list', () => {
    expect(parseEmirateList(' Dubai , Abu Dhabi ')).toEqual(['Dubai', 'Abu Dhabi']);
  });

  it('removes duplicates', () => {
    expect(parseEmirateList('Dubai,Dubai')).toEqual(['Dubai']);
  });

  it('rejects unknown emirates', () => {
    expect(() => parseEmirateList('Dubai,Doha')).toThrow('Unknown emirate: "Doha"');
  });

  it('rejects an empty list', () => {
    expect(() => parseEmirateList(' , ')).toThrow('At least one emirate');
  });
});
