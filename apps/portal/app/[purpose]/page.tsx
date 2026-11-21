import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { areaFromQuery, SearchPage } from '@/components/search-page';
import { getFacets } from '@/lib/api';
import { areaHeading, areaPath, PATH_PURPOSE, searchParamsToQuery } from '@/lib/format';

type Props = {
  params: Promise<{ purpose: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const segment = (await params).purpose;
  const purpose = PATH_PURPOSE[segment];
  if (!purpose) return {};
  const q = searchParamsToQuery(purpose, await searchParams);
  const area = areaFromQuery(q, await getFacets().catch(() => null));
  const title = areaHeading(purpose, area ?? {});
  // Filtered views point crawlers at the clean area page, so each area is indexed once.
  const canonical = area ? areaPath(purpose, area) : `/${segment}`;
  return {
    title,
    description: `${title}. Listings with advertising permits from licensed agencies; contact agents directly on WhatsApp or phone.`,
    alternates: { canonical },
  };
}

export default async function PurposePage({ params, searchParams }: Props) {
  const segment = (await params).purpose;
  const purpose = PATH_PURPOSE[segment];
  if (!purpose) notFound();
  return (
    <SearchPage
      purpose={purpose}
      area={{}}
      searchParams={await searchParams}
      basePath={`/${segment}`}
    />
  );
}
