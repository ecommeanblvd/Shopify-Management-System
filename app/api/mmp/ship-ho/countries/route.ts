/**
 * GET /api/mmp/ship-ho/countries
 * MMP → SMS: danh sách nước cho dropdown ship hộ. HMAC SHA-256 (x-mean-signature, x-mean-timestamp),
 * ký body rỗng: `HMAC(secret, "${timestamp}.")`.
 * Trả: { countries: [{ code (ISO-3166-1 alpha-2), name, dialCode }] }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requireMmpSignature } from '@/features/mmp/require-signature';
import { COUNTRIES } from '@/lib/geo/countries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<Response> {
  const denied = await requireMmpSignature(req);
  if (denied) return denied;

  return NextResponse.json({
    countries: COUNTRIES.map((c) => ({ code: c.iso2, name: c.name, dialCode: c.dialCode })),
  });
}
