import Link from 'next/link';
import { Breadcrumbs, type Crumb } from '@/components/breadcrumbs';
import { BannerStrip } from '@/components/banners';
import { Results } from '@/components/results';
import { SearchForm } from '@/components/search-form';
import { getFacets, getSite, searchListings, type Facets } from '@/lib/api';
import {
  areaHeading,
  areaPath,
  PURPOSE_PATH,
  searchParamsToQuery,
  TYPE_LABEL,
  TYPE_SEGMENT,
  type AreaFilter,
  type Purpose,
} from '@/lib/format';

type SP = Record<string, string | string[] | undefined>;

/** Breadcrumb trail for an area: Buy / Dubai / Dubai Marina / Apartments. */
export function areaCrumbs(purpose: Purpose, f: AreaFilter): Crumb[] {
  const crumbs: Crumb[] = [
    { name: purpose === 'rent' ? 'Rent' : 'Buy', href: `/${PURPOSE_PATH[purpose]}` },
  ];
  if (f.emirate) crumbs.push({ name: f.emirate, href: areaPath(purpose, { emirate: f.emirate }) });
  if (f.emirate && f.community) {
    crumbs.push({
      name: f.community,
      href: areaPath(purpose, { emirate: f.emirate, community: f.community }),
    });
  }
  if (f.type) {
    crumbs.push({ name: `${TYPE_LABEL[f.type] ?? 'Property'}s`, href: areaPath(purpose, f) });
  }
  return crumbs;
}

/** The area a set of query filters points at, when it can be a clean area page. */
export function areaFromQuery(q: URLSearchParams, facets: Facets | null): AreaFilter | null {
  const f: AreaFilter = {};
  const type = q.get('type');
  if (type && TYPE_SEGMENT[type]) f.type = type;
  const community = q.get('community');
  const emirate = q.get('emirate');
  if (community) {
    const c = facets?.communities.find(
      (x) => x.community.toLowerCase() === community.toLowerCase(),
    );
    if (!c || (emirate && emirate !== c.emirate)) return null;
    f.emirate = c.emirate;
    f.community = c.community;
  } else if (emirate) {
    f.emirate = emirate;
  }
  return f.type || f.emirate ? f : null;
}

export async function SearchPage({
  purpose,
  area,
  searchParams,
  basePath,
}: {
  purpose: Purpose;
  area: AreaFilter;
  searchParams: SP;
  basePath: string;
}) {
  const query = searchParamsToQuery(purpose, searchParams);
  // The path's area wins over any query parameters for the same filters.
  for (const k of ['type', 'emirate', 'community'] as const) {
    if (area[k]) query.set(k, area[k]!);
  }
  const [facets, result, site] = await Promise.all([
    getFacets().catch(() => null),
    searchListings(query).catch(() => null),
    getSite(),
  ]);
  const topBanner = site.banners.search_top[0];
  const values = Object.fromEntries(query.entries());
  const linkParams = new URLSearchParams(query);
  for (const k of ['type', 'emirate', 'community'] as const) if (area[k]) linkParams.delete(k);

  // Communities inside this emirate, for internal links (good for people and crawlers).
  const nearby =
    area.emirate && !area.community
      ? (facets?.communities ?? [])
          .filter((c) => c.emirate === area.emirate)
          .sort((a, b) => b.count - a.count)
          .slice(0, 12)
      : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {area.emirate || area.type ? <Breadcrumbs items={areaCrumbs(purpose, area)} /> : null}
      <div className="rounded-2xl border border-border bg-muted p-4">
        <SearchForm facets={facets} values={values} purpose={purpose} />
      </div>
      {topBanner ? (
        <div className="mt-6">
          <BannerStrip banner={topBanner} />
        </div>
      ) : null}
      <div className="mb-4 mt-8 flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-bold">
          {areaHeading(
            purpose,
            area.emirate || area.type
              ? area
              : {
                  ...(query.get('type') ? { type: query.get('type')! } : {}),
                  ...(query.get('emirate') ? { emirate: query.get('emirate')! } : {}),
                  ...(query.get('community') ? { community: query.get('community')! } : {}),
                },
          )}
        </h1>
        {result ? (
          <p className="shrink-0 text-sm text-muted-foreground">
            {result.total} {result.total === 1 ? 'property' : 'properties'}
          </p>
        ) : null}
      </div>
      {nearby.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {nearby.map((c) => (
            <Link
              key={c.community}
              href={areaPath(purpose, { ...area, community: c.community })}
              className="rounded-full border border-border px-3 py-1 text-sm hover:border-primary hover:text-primary"
            >
              {c.community} <span className="text-muted-foreground">({c.count})</span>
            </Link>
          ))}
        </div>
      ) : null}
      <Results result={result} basePath={basePath} params={linkParams} />
    </div>
  );
}
