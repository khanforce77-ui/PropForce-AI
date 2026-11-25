import type { PropertyStatus, PropertySummary } from './api';

export const PROPERTY_TYPES = [
  'apartment',
  'villa',
  'townhouse',
  'penthouse',
  'office',
  'retail',
  'commercial',
  'land',
  'other',
] as const;

export const STATUS_LABEL: Record<PropertyStatus, string> = {
  draft: 'Draft',
  active: 'Live',
  under_offer: 'Under offer',
  sold: 'Sold',
  rented: 'Rented',
  archived: 'Archived',
};

export const STATUS_TONE: Record<PropertyStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  active: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  under_offer: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200',
  sold: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  rented: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  archived: 'bg-muted text-muted-foreground',
};

/** Moves offered from each status; mirrors the API's lifecycle rules. */
export function nextStatuses(p: Pick<PropertySummary, 'status' | 'listingType'>): PropertyStatus[] {
  const closed: PropertyStatus = p.listingType === 'sale' ? 'sold' : 'rented';
  const map: Record<PropertyStatus, PropertyStatus[]> = {
    draft: ['active', 'archived'],
    active: ['draft', 'under_offer', closed, 'archived'],
    under_offer: ['active', 'draft', closed, 'archived'],
    sold: ['archived'],
    rented: ['active', 'archived'],
    archived: ['draft'],
  };
  return map[p.status];
}

const aed = new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 });

export function formatPrice(p: {
  price: string | number | null;
  rentPeriod: PropertySummary['rentPeriod'];
}): string {
  if (!p.price) return '—';
  const amount = `AED ${aed.format(Number(p.price))}`;
  return p.rentPeriod ? `${amount} / ${p.rentPeriod === 'yearly' ? 'year' : 'month'}` : amount;
}

export function bedroomsLabel(bedrooms: number | null): string {
  if (bedrooms === null) return '—';
  return bedrooms === 0 ? 'Studio' : `${bedrooms} BR`;
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
