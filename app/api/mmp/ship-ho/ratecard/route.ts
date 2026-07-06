/**
 * POST /api/mmp/ship-ho/ratecard
 * MMP → SMS: rate card ship hộ brand-facing của 1 brand (pull, per-brand).
 * HMAC SHA-256 (x-mean-signature, x-mean-timestamp), secret MMP_WEBHOOK_SECRET.
 * Body: { brandSlug }. Trả { ok, ratecard } — xem docs/mmp-ship-ho-ratecard.md.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { buildBrandRateCardPayload } from '@/features/ship-ho/mmp-ratecard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_STATUS: Record<string, number> = {
  brand_not_approved: 403, no_carrier: 422, bad_input: 400,
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

  let body: { brandSlug?: string };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.brandSlug) return NextResponse.json({ error: 'brandSlug required' }, { status: 400 });

  const r = await buildBrandRateCardPayload(body.brandSlug);
  if (!r.ok) return NextResponse.json({ error: r.code, code: r.code }, { status: CODE_STATUS[r.code] ?? 400 });
  return NextResponse.json({ ok: true, ratecard: r.ratecard });
}
