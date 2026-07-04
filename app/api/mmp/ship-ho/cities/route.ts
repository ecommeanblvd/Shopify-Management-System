/**
 * GET /api/mmp/ship-ho/cities?country=SA
 * MMP → SMS: thành phố major theo nước cho dropdown ship hộ. HMAC như /countries.
 * Trả: { country, cities: string[] } — [] nếu nước chưa curate (MMP cho gõ tay).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireMmpSignature } from '@/features/mmp/require-signature';
import { listCities } from '@/features/geo/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireMmpSignature(req);
  if (denied) return denied;

  const sp = new URL(req.url).searchParams;
  const country = (sp.get('country') ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country (ISO-3166-1 alpha-2) required' }, { status: 400 });
  }

  const state = sp.get('state')?.toUpperCase() || undefined;
  return NextResponse.json({ country, cities: await listCities(country, state) });
}
