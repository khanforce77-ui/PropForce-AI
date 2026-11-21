import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SearchPage } from '@/components/search-page';
import { getFacets } from '@/lib/api';
import {
  areaHeading,
  areaPath,
  PATH_PURPOSE,
  parseAreaSegments,
  type AreaFilter,
} from '@/lib/format';

type Props = {
  params: Promise<{ purpose: string; area: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function resolve(params: Props['params']) {
  const { purpose: segment, area: segments } = await params;
  const purpose = PATH_PURPOSE[segment];
  if (!purpose) return null;
  const facets = await getFacets().catch(() => null);
  // Without facets the area cannot be checked; fall back to a plain 404 rather than guessing.
  if (!facets) return null;
  const area = parseAreaSegments(segments, facets);
  return area ? { purpose, area } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await resolve(params);
  if (!r) return { title: 'Not found', robots: { index: false } };
  const title = areaHeading(r.purpose, r.area);
  return {
    title,
    description: `${title}. Listings with advertising permits from licensed agencies; contact agents directly on WhatsApp or phone.`,
    alternates: { canonical: areaPath(r.purpose, r.area) },
  };
}

export default async function AreaPage({ params, searchParams }: Props) {
  const r = await resolve(params);
  if (!r) notFound();
  const area: AreaFilter = r.area;
  return (
    <SearchPage
      purpose={r.purpose}
      area={area}
      searchParams={await searchParams}
      basePath={areaPath(r.purpose, area)}
    />
  );
}
