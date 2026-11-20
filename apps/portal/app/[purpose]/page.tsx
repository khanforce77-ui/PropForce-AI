import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Results } from '@/components/results';
import { SearchForm } from '@/components/search-form';
import { getFacets, searchListings } from '@/lib/api';
import { PATH_PURPOSE, searchParamsToQuery, TYPE_LABEL, type Purpose } from '@/lib/format';

type Props = {
  params: Promise<{ purpose: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function heading(purpose: Purpose, q: URLSearchParams) {
  const type = q.get('type');
  const what = type ? `${TYPE_LABEL[type] ?? 'Properties'}s` : 'Properties';
  const where = q.get('community') ?? q.get('emirate') ?? 'the UAE';
  return `${what.replace('Propertys', 'Properties')} for ${purpose === 'rent' ? 'rent' : 'sale'} in ${where}`;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const purpose = PATH_PURPOSE[(await params).purpose];
  if (!purpose) return {};
  const q = searchParamsToQuery(purpose, await searchParams);
  const title = heading(purpose, q);
  // Canonical keeps only the main location and type filters, so crawlers do not index every combination.
  const canonical = new URLSearchParams();
  for (const k of ['community', 'emirate', 'type']) if (q.get(k)) canonical.set(k, q.get(k)!);
  const path = `/${(await params).purpose}${canonical.size ? `?${canonical}` : ''}`;
  return {
    title,
    description: `${title}. Verified listings with advertising permits; contact agents directly on WhatsApp or phone.`,
    alternates: { canonical: path },
  };
}

export default async function PurposePage({ params, searchParams }: Props) {
  const segment = (await params).purpose;
  const purpose = PATH_PURPOSE[segment];
  if (!purpose) notFound();
  const sp = await searchParams;
  const query = searchParamsToQuery(purpose, sp);
  const [facets, result] = await Promise.all([
    getFacets().catch(() => null),
    searchListings(query).catch(() => null),
  ]);
  const values = Object.fromEntries(query.entries());

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="rounded-2xl border border-border bg-muted p-4">
        <SearchForm facets={facets} values={values} purpose={purpose} />
      </div>
      <div className="mb-4 mt-8 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">{heading(purpose, query)}</h1>
        {result ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            {result.total} {result.total === 1 ? 'property' : 'properties'}
          </p>
        ) : null}
      </div>
      <Results result={result} basePath={`/${segment}`} params={query} />
    </div>
  );
}
