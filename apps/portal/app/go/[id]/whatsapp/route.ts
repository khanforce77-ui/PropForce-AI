import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, recordContact } from '@/lib/api';

/**
 * WhatsApp button target: records the click for the agent, then sends the visitor to wa.me.
 * A plain link (not a script) so it works in every browser without pop-up blockers. Crawlers are
 * kept away by rel="nofollow" and robots.txt, and the API ignores repeat clicks.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { href } = await recordContact(id, 'whatsapp');
    if (!href.startsWith('https://wa.me/')) throw new Error('Unexpected link');
    return NextResponse.redirect(href, { status: 303, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    const status = err instanceof ApiError && err.status === 404 ? 404 : 409;
    const back = new URL(
      `/property/${encodeURIComponent(id)}?contact=${status === 404 ? 'gone' : 'unavailable'}`,
      req.url,
    );
    return NextResponse.redirect(back, { status: 303 });
  }
}
