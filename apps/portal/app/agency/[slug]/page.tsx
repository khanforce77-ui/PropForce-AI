import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Results } from '@/components/results';
import { searchListings } from '@/lib/api';
import { searchParamsToQuery } from '@/lib/format';

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const SLUG = /^[a-z0-9-]{1,80}$/;

async function load(slug: string, sp: Record<string, string | string[] | undefined>) {
  if (!SLUG.test(slug)) notFound();
  const query = searchParamsToQuery(undefined, { ...sp, agency: slug });
  const result = await searchListings(query).catch(() => null);
  return { query, result };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (!SLUG.test(slug)) return {};
  const result = await searchListings(new URLSearchParams({ agency: slug, pageSize: '1' })).catch(
    () => null,
  );
  const name = result?.data[0]?.agency.name;
  return name
    ? {
        title: `${name}: properties for sale and rent`,
        alternates: { canonical: `/agency/${slug}` },
      }
    : { title: 'Agency', robots: { index: false } };
}

export default async function AgencyPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { query, result } = await load(slug, await searchParams);
  const agency = result?.data[0]?.agency;
  if (result && !agency) notFound();
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">{agency?.name ?? 'Agency'}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {[
          agency?.emirate,
          agency?.orn ? `ORN ${agency.orn}` : null,
          result ? `${result.total} live listings` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <div className="mt-6">
        <Results
          result={result}
          basePath={`/agency/${slug}`}
          params={(() => {
            const p = new URLSearchParams(query);
            p.delete('agency');
            return p;
          })()}
        />
      </div>
    </div>
  );
}
