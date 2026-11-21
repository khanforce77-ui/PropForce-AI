import { apiUrl } from '@/lib/config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

/**
 * Agent profile photo, served from the portal's own domain. The URL carries ?v=<photo version>,
 * so a new photo gets a new URL and the bytes can be cached for a long time.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response('Not found', { status: 404 });
  const res = await fetch(`${apiUrl()}/v1/public/agents/${id}/photo`, {
    next: { revalidate: 3600 },
  });
  const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!res.ok || !TYPES.has(type)) {
    return new Response('Not found', {
      status: 404,
      headers: { 'cache-control': 'public, max-age=300' },
    });
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=86400, s-maxage=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
