/**
 * Verify HMAC SHA-256 cho request MMP → SMS (x-mean-signature, x-mean-timestamp).
 * Trả `null` nếu hợp lệ; hoặc `Response` lỗi (500 khi thiếu secret, 401 khi chữ ký sai).
 *
 * Dùng cho endpoint GET (geo): body rỗng vẫn ký được — MMP ký `HMAC(secret, "${timestamp}.")`.
 * (Route POST estimate/orders vẫn tự đọc rawBody để parse, nên inline verify riêng.)
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from './hmac';

export async function requireMmpSignature(req: NextRequest): Promise<Response | null> {
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });

  const rawBody = await req.text();
  const hmac = verifyMmpSignature({
    secret,
    rawBody,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });
  return null;
}
