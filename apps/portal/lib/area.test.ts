import { describe, expect, it } from 'vitest';
import { agentPath, areaHeading, areaPath, parseAreaSegments, searchParamsToQuery } from './format';

const known = {
  emirates: ['Dubai', 'Abu Dhabi'],
  communities: [
    { emirate: 'Dubai', community: 'Dubai Marina' },
    { emirate: 'Abu Dhabi', community: 'Al Reem Island' },
  ],
};

describe('area pages', () => {
  it('builds clean paths and reads them back', () => {
    const f = { type: 'apartment', emirate: 'Dubai', community: 'Dubai Marina' };
    const path = areaPath('sale', f);
    expect(path).toBe('/for-sale/apartments/dubai/dubai-marina');
    expect(parseAreaSegments(path.split('/').slice(2), known)).toEqual(f);
    expect(areaPath('rent', { emirate: 'Abu Dhabi' })).toBe('/for-rent/abu-dhabi');
    expect(parseAreaSegments(['abu-dhabi', 'al-reem-island'], known)).toEqual({
      emirate: 'Abu Dhabi',
      community: 'Al Reem Island',
    });
    expect(parseAreaSegments(['villas'], known)).toEqual({ type: 'villa' });
  });

  it('refuses unknown places and communities in the wrong emirate', () => {
    expect(parseAreaSegments(['sharjah'], known)).toBeNull();
    expect(parseAreaSegments(['dubai', 'al-reem-island'], known)).toBeNull();
    expect(parseAreaSegments(['dubai', 'dubai-marina', 'extra'], known)).toBeNull();
    expect(parseAreaSegments([], known)).toBeNull();
  });

  it('writes headings and agent paths', () => {
    expect(areaHeading('sale', { type: 'villa', community: 'Arabian Ranches' })).toBe(
      'Villas for sale in Arabian Ranches',
    );
    expect(areaHeading('rent', {})).toBe('Properties for rent in the UAE');
    expect(agentPath({ id: 'abc', name: 'Sara Khan' })).toBe('/agent/sara-khan-abc');
  });

  it('keeps the new numeric filters only when they are numbers', () => {
    const q = searchParamsToQuery('sale', { baths: '2', minArea: 'x', amenity: 'Pool' });
    expect(q.get('baths')).toBe('2');
    expect(q.has('minArea')).toBe(false);
    expect(q.get('amenity')).toBe('Pool');
  });
});
