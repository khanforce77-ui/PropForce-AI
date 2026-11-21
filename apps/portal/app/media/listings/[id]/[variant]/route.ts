import { apiUrl } from '@/lib/config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIANTS = new Set(['display', 'thumb']);
const TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

/**
 * Watermarked listing photo, served from the portal's own domain. The URL carries
 * ?v=<photo version> (it changes with the photo or the agency logo), so it can be cached long.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string; variant: string }> },
) {
  const { id, variant } = await params;
  if (!UUID.test(id) || !VARIANTS.has(variant)) return new Response('Not found', { status: 404 });
  const v = new URL(req.url).searchParams.get('v') ?? '';
  const res = await fetch(
    `${apiUrl()}/v1/public/listing-photos/${id}/${variant}?v=${encodeURIComponent(v)}`,
    { next: { revalidate: 3600 } },
  );
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
