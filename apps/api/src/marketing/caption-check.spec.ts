import { describe, expect, it } from 'vitest';
import { checkCaption } from './caption-check';

const facts = { price: 1_850_000, bedrooms: 2, areaSqft: 1200 };

describe('checkCaption', () => {
  it('accepts the listing’s own figures', () => {
    expect(checkCaption('Bright 2 bed in Marina, 1,200 sq ft, AED 1.85M', facts)).toEqual([]);
  });
  it('flags invented prices, bedrooms and sizes', () => {
    expect(checkCaption('3 bedroom, 1,500 sqft, only AED 1.5M', facts)).toEqual([
      'price 1500000',
      'bedrooms 3',
      'size 1500',
    ]);
  });
  it('flags a price when the listing has none', () => {
    expect(checkCaption('Yours for AED 900k', { ...facts, price: null })).toEqual(['price 900000']);
  });
  it('flags promised returns and visas', () => {
    expect(checkCaption('Guaranteed 8% rental return!', facts)).toEqual([
      'promise of returns or visa',
    ]);
    expect(checkCaption('Qualifies you for a Golden Visa', facts)).toEqual([
      'promise of returns or visa',
    ]);
  });
});
