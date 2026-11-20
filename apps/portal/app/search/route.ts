import { NextResponse, type NextRequest } from 'next/server';
import { PURPOSE_PATH, searchParamsToQuery, type Purpose } from '@/lib/format';

/** Sends the search form on to its canonical results URL, dropping empty fields. */
export function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const purpose: Purpose = params.purpose === 'rent' ? 'rent' : 'sale';
  const query = searchParamsToQuery(undefined, params);
  if (query.get('sort') === 'newest') query.delete('sort');
  const qs = query.toString();
  return NextResponse.redirect(
    new URL(`/${PURPOSE_PATH[purpose]}${qs ? `?${qs}` : ''}`, req.url),
    303,
  );
}
