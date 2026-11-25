import type { LeadIntent, ListingType, PropertyType, RentPeriod } from '@propforce/db';

/**
 * Lead-to-listing matching. Pure functions, no database: the service loads candidates and this
 * decides whether each one fits and how well. Rules are deliberately explainable, so an agent can
 * see why a listing was suggested (reasons) and what does not fit (gaps).
 *
 * Hard rules (a listing that breaks one is never suggested):
 * - buy/invest leads match sale listings, rent leads match rent listings; sell/let leads are
 *   owners and do not match listings.
 * - emirate must be the same when the lead names one;
 * - property type must be one the lead asked for, when the lead names any;
 * - price may be at most 10% over the lead's maximum budget;
 * - bedrooms may be at most one outside the lead's range.
 */

export interface LeadCriteria {
  intent: LeadIntent;
  emirate: string | null;
  communities: readonly string[];
  propertyTypes: readonly PropertyType[];
  bedroomsMin: number | null;
  bedroomsMax: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
}

export interface ListingFacts {
  listingType: ListingType;
  emirate: string;
  community: string | null;
  subCommunity: string | null;
  building: string | null;
  propertyType: PropertyType;
  bedrooms: number | null;
  price: number | null;
  rentPeriod: RentPeriod | null;
}

export interface MatchResult {
  /** 0 to 100. */
  score: number;
  reasons: string[];
  gaps: string[];
}

/** Over-budget tolerance: agents routinely show listings a little above budget. */
export const BUDGET_STRETCH = 0.1;

export function listingTypeFor(intent: LeadIntent): ListingType | null {
  if (intent === 'buy') return 'sale';
  if (intent === 'rent') return 'rent';
  return null;
}

/** UAE rents are quoted per year; monthly listings are compared at twelve times the price. */
export function yearlyPrice(price: number | null, rentPeriod: RentPeriod | null): number | null {
  if (price == null) return null;
  return rentPeriod === 'monthly' ? price * 12 : price;
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

const aed = (n: number) => `AED ${Math.round(n).toLocaleString('en-US')}`;

export function scoreMatch(lead: LeadCriteria, l: ListingFacts): MatchResult | null {
  const wanted = listingTypeFor(lead.intent);
  if (!wanted || l.listingType !== wanted) return null;
  if (lead.emirate && norm(lead.emirate) !== norm(l.emirate)) return null;
  if (lead.propertyTypes.length && !lead.propertyTypes.includes(l.propertyType)) return null;

  const reasons: string[] = [];
  const gaps: string[] = [];
  // Points available per criterion; a criterion the lead left open counts as a fit.
  let score = 0;

  // Location: 35 points.
  if (lead.communities.length) {
    const places = [l.community, l.subCommunity, l.building].map(norm).filter(Boolean);
    const hit = lead.communities.find((c) => places.includes(norm(c)));
    if (hit) {
      score += 35;
      reasons.push(`In ${hit}`);
    } else {
      gaps.push(`Not in ${lead.communities.join(', ')}`);
    }
  } else {
    score += 20;
  }

  // Property type: 10 points (a wrong type was already ruled out above).
  score += 10;
  if (lead.propertyTypes.length) reasons.push(`Type: ${l.propertyType}`);

  // Bedrooms: 25 points.
  const { bedroomsMin: bMin, bedroomsMax: bMax } = lead;
  if (bMin == null && bMax == null) {
    score += 15;
  } else if (l.bedrooms == null) {
    score += 5;
    gaps.push('Bedrooms not given');
  } else {
    const below = bMin != null ? bMin - l.bedrooms : 0;
    const above = bMax != null ? l.bedrooms - bMax : 0;
    const off = Math.max(below, above, 0);
    if (off > 1) return null;
    const beds = l.bedrooms === 0 ? 'Studio' : `${l.bedrooms} bed`;
    if (off === 0) {
      score += 25;
      reasons.push(beds);
    } else {
      score += 8;
      gaps.push(`${beds}, ${below > 0 ? 'one fewer' : 'one more'} than asked`);
    }
  }

  // Budget: 30 points.
  const price = yearlyPrice(l.price, l.rentPeriod);
  const per = l.listingType === 'rent' ? ' a year' : '';
  if (lead.budgetMax == null && lead.budgetMin == null) {
    score += 20;
  } else if (price == null) {
    score += 5;
    gaps.push('Price on request');
  } else if (lead.budgetMax != null && price > lead.budgetMax) {
    if (price > lead.budgetMax * (1 + BUDGET_STRETCH)) return null;
    score += 10;
    const pct = Math.ceil(((price - lead.budgetMax) / lead.budgetMax) * 100);
    gaps.push(`${aed(price)}${per}, ${pct}% over budget`);
  } else if (lead.budgetMin != null && price < lead.budgetMin * 0.7) {
    // Far under the stated budget usually means a different product than the client wants.
    score += 15;
    gaps.push(`${aed(price)}${per}, well under budget`);
  } else {
    score += 30;
    reasons.push(`${aed(price)}${per}, within budget`);
  }

  return { score: Math.min(100, score), reasons, gaps };
}

/** Best first; ties go to the newer item. */
export function rankMatches<T extends { match: MatchResult; createdAt: Date }>(
  items: T[],
  limit: number,
): T[] {
  return items
    .sort((a, b) => b.match.score - a.match.score || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit);
}
