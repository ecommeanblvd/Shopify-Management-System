/**
 * GET /api/mmp/ship-ho/postcode?country=US&code=90210
 * MMP → SMS: tra + validate postcode. HMAC body-rỗng.
 * Trả: { country, code, valid, city, state, candidates } — valid=null nghĩa nước chưa nạp (cho free-entry).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireMmpSignature } from '@/features/mmp/require-signature';
import { lookupPostcode } from '@/features/geo/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireMmpSignature(req);
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const country = (sp.get('country') ?? '').toUpperCase();
  const code = (sp.get('code') ?? '').trim();
  if (!/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country (ISO-3166-1 alpha-2) required' }, { status: 400 });
  }
  if (!code) return NextResponse.json({ error: 'code (postcode) required' }, { status: 400 });
  const r = await lookupPostcode(country, code);
  return NextResponse.json({
    country, code, valid: r.valid, city: r.city, state: r.stateCode, candidates: r.candidates,
  });
}
