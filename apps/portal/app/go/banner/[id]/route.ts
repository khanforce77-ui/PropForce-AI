import { NextResponse, type NextRequest } from 'next/server';
import { clickBanner } from '@/lib/api';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Banner link target: counts the click, then sends the visitor on. The API only stores https
 * links or paths on this site, and this route checks again before redirecting.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = new URL('/', req.url);
  if (!UUID.test(id)) return NextResponse.redirect(home, { status: 303 });
  try {
    const { url } = await clickBanner(id);
    const target =
      url.startsWith('/') && !url.startsWith('//') ? new URL(url, req.url) : new URL(url);
    if (target.protocol !== 'https:' && target.origin !== home.origin) throw new Error('unsafe');
    return NextResponse.redirect(target, {
      status: 303,
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return NextResponse.redirect(home, { status: 303 });
  }
}
