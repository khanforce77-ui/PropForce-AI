import { describe, expect, it } from 'vitest';
import {
  bedsLabel,
  formatPrice,
  idFromSlug,
  listingPath,
  listingTitle,
  searchParamsToQuery,
} from './format';

const id = '0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('format', () => {
  it('formats prices in AED with rent periods', () => {
    expect(formatPrice(2_400_000)).toBe('AED 2,400,000');
    expect(formatPrice(120_000, 'yearly')).toBe('AED 120,000 / year');
    expect(formatPrice(null)).toBe('Price on request');
  });

  it('labels studios and bedrooms', () => {
    expect(bedsLabel(0)).toBe('Studio');
    expect(bedsLabel(1)).toBe('1 Bed');
    expect(bedsLabel(3)).toBe('3 Beds');
  });

  it('builds a readable title and an SEO path that round-trips the id', () => {
    const l = {
      id,
      title: null,
      bedrooms: 2,
      type: 'apartment',
      purpose: 'sale' as const,
      community: 'Dubai Marina',
      emirate: 'Dubai',
    };
    expect(listingTitle(l)).toBe('2 Bed Apartment for sale in Dubai Marina');
    const path = listingPath(l);
    expect(path).toBe(`/property/2-bed-apartment-for-sale-in-dubai-marina-${id}`);
    expect(idFromSlug(path.replace('/property/', ''))).toBe(id);
    expect(idFromSlug('not-a-listing')).toBeNull();
  });

  it('keeps only known, well-formed search parameters', () => {
    const q = searchParamsToQuery('rent', {
      community: 'JVC',
      beds: '2',
      minPrice: 'abc',
      evil: 'x',
      page: ['3', '4'],
    });
    expect(q.toString()).toBe('purpose=rent&community=JVC&beds=2&page=3');
  });
});
