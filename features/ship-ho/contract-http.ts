/**
 * Handler dùng chung cho endpoint nhận hợp đồng MMP đẩy sang — được gắn ở CẢ
 * `/api/mmp/contracts` (path MMP chốt 05/08, cùng base với /api/mmp/products)
 * và `/api/mmp/ship-ho/contract` (path công bố trước đó, giữ để không vỡ nếu
 * MMP đã trỏ vào). Cùng secret `MMP_WEBHOOK_SECRET` như endpoint products.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { ingestMmpContract } from './contract-ingest';

const CODE_STATUS: Record<string, number> = {
  bad_input: 400,
  brand_not_approved: 403,
  storage_unconfigured: 500,
  error: 500,
};

export async function handleMmpContractRequest(req: NextRequest): Promise<Response> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured on SMS — contact ops' }, { status: 500 });

  // Body hợp đồng lớn (~195KB, Phụ lục 01 có bảng phí ~200 điểm đến) — App
  // Router đọc raw text không giới hạn kiểu bodyParser, chỉ chặn ở mức 5MB
  // trong parseMmpContract.
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
