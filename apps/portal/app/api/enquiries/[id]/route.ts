import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, sendEnquiry } from '@/lib/api';
import { isSameOrigin } from '@/lib/same-origin';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req.headers.get('origin'), req.headers.get('host'))) {
    return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
  }
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: 'Invalid request' }, { status: 400 });
  }
  try {
    const res = await sendEnquiry(id, body);
    return NextResponse.json(res, { status: 202, headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { message: err.body.message, errors: err.body.errors },
        { status: err.status },
      );
    }
    return NextResponse.json({ message: 'Could not send your enquiry.' }, { status: 502 });
  }
}
