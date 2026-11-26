import { extractAedAmounts, extractBedrooms, extractSqft } from '@propforce/ai';

export interface CaptionFacts {
  price: number | null;
  bedrooms: number | null;
  areaSqft: number | null;
}

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.005);

const PROMISES =
  /\b(guarantee[ds]?|guaranteed|assured|risk[- ]free)\b.{0,40}\b(return|roi|yield|profit|rent|appreciation|income|visa)|\b(golden visa)\b/i;

/**
 * Backstop on what the model wrote: every price, bedroom count and size must be the listing's
 * own, and no promised returns or visas. Returns the problems found (empty = fine).
 */
export function checkCaption(text: string, facts: CaptionFacts): string[] {
  const problems: string[] = [];
  for (const amount of extractAedAmounts(text)) {
    if (facts.price == null || !close(amount, facts.price)) problems.push(`price ${amount}`);
  }
  for (const beds of extractBedrooms(text)) {
    if (facts.bedrooms == null || beds !== facts.bedrooms) problems.push(`bedrooms ${beds}`);
  }
  for (const sqft of extractSqft(text)) {
    if (facts.areaSqft == null || !close(sqft, facts.areaSqft)) problems.push(`size ${sqft}`);
  }
  if (PROMISES.test(text)) problems.push('promise of returns or visa');
  return problems;
}
