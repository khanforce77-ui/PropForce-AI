import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, recordContact } from '@/lib/api';
import { isSameOrigin } from '@/lib/same-origin';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { channel?: unknown };
  if (body.channel !== 'whatsapp' && body.channel !== 'call') {
    return NextResponse.json({ message: 'Unknown channel' }, { status: 400 });
  }
  try {
    const res = await recordContact(id, body.channel);
    return NextResponse.json(res, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ message: err.body.message }, { status: err.status });
    }
    return NextResponse.json({ message: 'Could not reach the agent.' }, { status: 502 });
  }
}
