import type { MetadataRoute } from 'next';
import { getSitemap } from '@/lib/api';
import { siteUrl } from '@/lib/config';
import { listingPath } from '@/lib/format';

export const revalidate = 600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const fixed: MetadataRoute.Sitemap = ['', '/for-sale', '/for-rent'].map((p) => ({
    url: `${base}${p}`,
    changeFrequency: 'hourly',
  }));
  const listings = await getSitemap().catch(() => ({ data: [] }));
  return [
    ...fixed,
    ...listings.data.map((l) => ({
      url: `${base}${listingPath({ id: l.id, title: l.title, bedrooms: l.bedrooms, type: l.propertyType, purpose: l.listingType, community: l.community, emirate: l.emirate })}`,
      lastModified: l.updatedAt,
    })),
  ];
}
