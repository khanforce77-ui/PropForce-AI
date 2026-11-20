import Link from 'next/link';
import { ListingCard } from '@/components/listing-card';
import type { SearchResult } from '@/lib/api';

export function Results({
  result,
  basePath,
  params,
}: {
  result: SearchResult | null;
  basePath: string;
  params: URLSearchParams;
}) {
  if (!result) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        Listings are temporarily unavailable. Please try again shortly.
      </p>
    );
  }
  if (result.data.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
        No properties match these filters yet. Try widening your search.
      </p>
    );
  }
  const pages = Math.ceil(result.total / result.pageSize);
  const pageHref = (page: number) => {
    const p = new URLSearchParams(params);
    p.delete('purpose');
    if (page > 1) p.set('page', String(page));
    else p.delete('page');
    const qs = p.toString();
    return `${basePath}${qs ? `?${qs}` : ''}`;
  };
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {result.data.map((l) => (
          <ListingCard key={l.id} listing={l} />
        ))}
      </div>
      {pages > 1 ? (
        <nav className="mt-8 flex items-center justify-center gap-3 text-sm" aria-label="Pages">
          {result.page > 1 ? (
            <Link
              href={pageHref(result.page - 1)}
              rel="prev"
              className="rounded-lg border border-border px-4 py-2 hover:border-primary"
            >
              Previous
            </Link>
          ) : null}
          <span className="text-muted-foreground">
            Page {result.page} of {pages}
          </span>
          {result.page < pages ? (
            <Link
              href={pageHref(result.page + 1)}
              rel="next"
              className="rounded-lg border border-border px-4 py-2 hover:border-primary"
            >
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
