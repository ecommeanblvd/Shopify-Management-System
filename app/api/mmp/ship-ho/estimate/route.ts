/**
 * POST /api/mmp/ship-ho/estimate
 * MMP → SMS: brand estimate giá 1 kiện. HMAC SHA-256 (x-mean-signature, x-mean-timestamp).
 * Body: { brandSlug, parcel: { country, city?, postcode?, weightKg, dimLengthCm?, dimWidthCm?, dimHeightCm?, packagingType?, service? } }
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { estimateForBrand, type EstimateParcel } from '@/features/ship-ho/brand-estimate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_STATUS: Record<string, number> = {
  brand_not_approved: 403, no_carrier: 422, quote_failed: 422, service_unavailable: 422, bad_input: 400,
};

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });

  const rawBody = await req.text();
  const hmac = verifyMmpSignature({
    secret, rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  let body: { brandSlug?: string; parcel?: EstimateParcel };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.brandSlug || !body.parcel?.country || !(Number(body.parcel?.weightKg) > 0)) {
    return NextResponse.json({ error: 'brandSlug + parcel.country + parcel.weightKg(>0) required' }, { status: 400 });
  }

  const r = await estimateForBrand(body.brandSlug, body.parcel);
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: CODE_STATUS[r.code] ?? 400 });
  return NextResponse.json({ ok: true, estimate: r.estimate });
}
