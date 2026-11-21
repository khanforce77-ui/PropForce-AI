import { NextResponse, type NextRequest } from 'next/server';
import { searchListings } from '@/lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cards for a visitor's saved listings. Listings that are no longer public simply drop out. */
export async function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('ids') ?? '')
    .split(',')
    .filter((x) => UUID.test(x))
    .slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ data: [] });
  try {
    const res = await searchListings(new URLSearchParams({ ids: ids.join(','), pageSize: '48' }));
    return NextResponse.json({ data: res.data }, { headers: { 'cache-control': 'no-store' } });
  } catch {
    return NextResponse.json({ message: 'Could not load saved properties.' }, { status: 502 });
  }
}
