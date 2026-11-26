import { apiUrl } from '@/lib/config';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Banner and advert images, served from the portal's own domain. The URL carries ?v=<image
 * version>, so a new image gets a new URL. Only banners that are live right now are served.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response('Not found', { status: 404 });
  const res = await fetch(`${apiUrl()}/v1/public/site/banners/${id}/image`, {
    next: { revalidate: 300 },
  });
  const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!res.ok || type !== 'image/webp') {
    return new Response('Not found', {
      status: 404,
      headers: { 'cache-control': 'public, max-age=60' },
    });
  }
  return new Response(await res.arrayBuffer(), {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=3600, s-maxage=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
