import { NextResponse } from 'next/server';
import { retryPendingShipHoEvents } from '@/features/ship-ho/mmp-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    const r = await retryPendingShipHoEvents();
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
