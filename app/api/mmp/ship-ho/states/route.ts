/**
 * GET /api/mmp/ship-ho/states?country=US
 * MMP → SMS: state/province theo nước. HMAC body-rỗng.
 * Trả: { country, states: [{ code, name }] } — [] nếu nước chưa nạp.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireMmpSignature } from '@/features/mmp/require-signature';
import { listStates } from '@/features/geo/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireMmpSignature(req);
  if (denied) return denied;
  const country = (new URL(req.url).searchParams.get('country') ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country (ISO-3166-1 alpha-2) required' }, { status: 400 });
  }
  return NextResponse.json({ country, states: await listStates(country) });
}
