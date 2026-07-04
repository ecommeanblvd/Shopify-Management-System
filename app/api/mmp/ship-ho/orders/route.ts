/**
 * POST /api/mmp/ship-ho/orders
 * MMP → SMS: brand tạo đơn ship hộ. HMAC SHA-256 (x-mean-signature, x-mean-timestamp).
 * SMS sinh mã order mới; idempotent theo mmpRef.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { intakeBrandOrder, type BrandOrderInput } from '@/features/ship-ho/brand-order-intake';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_STATUS: Record<string, number> = {
  brand_not_approved: 403, bad_input: 400, quote_failed: 422, no_carrier: 422, service_unavailable: 422,
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

  let body: BrandOrderInput;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const r = await intakeBrandOrder(body);
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: CODE_STATUS[r.code] ?? 400 });
  return NextResponse.json({ ok: true, orderId: r.orderId, code: r.code, idempotent: r.idempotent ?? false, estimate: r.estimate });
}
