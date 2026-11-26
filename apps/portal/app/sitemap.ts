import type { MetadataRoute } from 'next';
import { getFacets, getSitemap } from '@/lib/api';
import { siteUrl } from '@/lib/config';
import { GUIDES } from '@/lib/guides';
import { areaPath, listingPath, TYPE_SEGMENT, type Purpose } from '@/lib/format';

export const revalidate = 600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const fixed: MetadataRoute.Sitemap = [
    ...['', '/for-sale', '/for-rent', '/new-projects'].map((p) => ({
      url: `${base}${p}`,
      changeFrequency: 'hourly' as const,
    })),
    ...['/guides', ...GUIDES.map((g) => `/guides/${g.slug}`), '/for-agencies', '/developers'].map(
      (p) => ({
        url: `${base}${p}`,
        changeFrequency: 'monthly' as const,
      }),
    ),
  ];
  const [listings, facets] = await Promise.all([
    getSitemap().catch(() => ({ data: [] })),
    getFacets().catch(() => null),
  ]);
  // Area pages that have listings: emirate, community, and each with the property types present.
  const areas = new Set<string>();
  const types = (facets?.types ?? []).map((t) => t.type).filter((t) => TYPE_SEGMENT[t]);
  for (const purpose of ['sale', 'rent'] as Purpose[]) {
    for (const emirate of new Set((facets?.communities ?? []).map((c) => c.emirate))) {
      areas.add(areaPath(purpose, { emirate }));
    }
    for (const c of facets?.communities ?? []) {
      areas.add(areaPath(purpose, { emirate: c.emirate, community: c.community }));
    }
    for (const type of types) areas.add(areaPath(purpose, { type }));
  }
  return [
    ...fixed,
    ...[...areas].map((p) => ({ url: `${base}${p}`, changeFrequency: 'daily' as const })),
    ...listings.data.map((l) => ({
      url: `${base}${listingPath({ id: l.id, title: l.title, bedrooms: l.bedrooms, type: l.propertyType, purpose: l.listingType, community: l.community, emirate: l.emirate })}`,
      lastModified: l.updatedAt,
    })),
  ];
}
