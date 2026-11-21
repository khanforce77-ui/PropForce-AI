import { NextResponse, type NextRequest } from 'next/server';
import { areaFromQuery } from '@/components/search-page';
import { getFacets } from '@/lib/api';
import { areaPath, PURPOSE_PATH, searchParamsToQuery, type Purpose } from '@/lib/format';

/**
 * Sends the search form on to its canonical results URL, dropping empty fields. A search for a
 * known place or type lands on its clean area page, e.g. /for-sale/apartments/dubai/dubai-marina.
 */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const purpose: Purpose = params.purpose === 'rent' ? 'rent' : 'sale';
  const query = searchParamsToQuery(undefined, params);
  if (query.get('sort') === 'newest') query.delete('sort');
  let path = `/${PURPOSE_PATH[purpose]}`;
  // Agency and agent searches keep their own pages' filters as plain parameters.
  if (!query.has('agency') && !query.has('agent')) {
    const area = areaFromQuery(query, await getFacets().catch(() => null));
    if (area) {
      path = areaPath(purpose, area);
      for (const k of ['type', 'emirate', 'community']) query.delete(k);
    }
  }
  const qs = query.toString();
  return NextResponse.redirect(new URL(`${path}${qs ? `?${qs}` : ''}`, req.url), 303);
}
