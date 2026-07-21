/**
 * POST /api/mmp/brands (HMAC như các endpoint mmp khác, body {} là đủ)
 * → danh sách brand với TÊN HIỂN THỊ CHUẨN (quy tắc 21/07: mỗi từ chỉ viết hoa
 * chữ cái đầu) để MMP đồng bộ hiển thị 2 bên.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { db, schema } from '@/db/client';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const secret = process.env.MMP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: 'MMP_WEBHOOK_SECRET not configured' }, { status: 500 });
  const hmac = verifyMmpSignature({
    secret,
    signatureHeader: req.headers.get('x-mean-signature'),
    timestampHeader: req.headers.get('x-mean-timestamp'),
    rawBody,
  });
  if (!hmac.ok) return NextResponse.json({ error: 'signature verification failed', reason: hmac.reason }, { status: 401 });

  const brands = await db
    .select({ slug: schema.mmpBrands.slug, displayName: schema.mmpBrands.displayName, status: schema.mmpBrands.status })
    .from(schema.mmpBrands)
    .orderBy(schema.mmpBrands.slug);
  return NextResponse.json({
    ok: true,
    rule: 'title-case-first-letter-only', // mỗi từ chỉ viết hoa chữ cái đầu
    brands,
  });
}
