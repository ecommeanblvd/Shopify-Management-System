/**
 * POST /api/mmp/ship-ho/partner-requests
 * MMP → SMS: brand đăng ký dịch vụ ship hộ. HMAC SHA-256 (x-mean-signature, x-mean-timestamp).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { createPartnerRequest } from '@/features/ship-ho/partner-request-actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });
  const rawBody = await req.text();
  const hmac = verifyMmpSignature({ secret, rawBody, signatureHeader: req.headers.get('x-mean-signature'), timestampHeader: req.headers.get('x-mean-timestamp') });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });
  let body: { brandSlug?: string };
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }
  if (!body.brandSlug) return NextResponse.json({ error: 'brandSlug required' }, { status: 400 });
  const r = await createPartnerRequest(body as { brandSlug: string });
  if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.code === 'bad_input' ? 400 : 422 });
  return NextResponse.json({ ok: true, ref: r.ref });
}
