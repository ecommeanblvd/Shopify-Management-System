/**
 * POST /api/mmp/ship-ho/contract
 * MMP → SMS: đẩy hợp đồng ship hộ/fulfillment của 1 brand (JSON + HTML).
 * HMAC SHA-256 (x-mean-signature, x-mean-timestamp), secret MMP_WEBHOOK_SECRET
 * — cùng scheme với các endpoint MMP inbound khác.
 *
 * Body: { brandSlug, brandName?, contractType, title, version, generatedAt, html }
 * Trả { ok, id, action: 'created'|'updated' }. Idempotent theo (brandSlug, version).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { ingestMmpContract } from '@/features/ship-ho/contract-ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CODE_STATUS: Record<string, number> = {
  bad_input: 400,
  brand_not_approved: 403,
  storage_unconfigured: 500,
  error: 500,
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

  let body: unknown;
  try { body = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  try {
    const r = await ingestMmpContract(body);
    if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: CODE_STATUS[r.code] ?? 400 });
    return NextResponse.json({ ok: true, id: r.id, action: r.action });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'ingest failed', code: 'error' }, { status: 500 });
  }
}
