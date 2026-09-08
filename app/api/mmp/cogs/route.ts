/**
 * POST /api/mmp/cogs — CHƯA BẬT/CHƯA BÁO MMP (đợi CEO xác nhận thiết kế). Route tồn tại, được bảo vệ
 * bằng HMAC như mọi endpoint mmp khác; xem hợp đồng payload ở docs/cogs.md.
 *
 * MMP → SMS: đẩy giá vốn theo line đơn / chi ngoài Shopify của một kỳ (tháng), cấu trúc trung gian
 * giống bộ nhập bảng kê brand (features/cogs/bang-ke-import.ts) — đi qua ĐÚNG luật ghép (spec §4) và
 * hàm ghi `apDungBangKeDaDoc`, nguồn `source: 'mmp'` (không đụng dòng `brand_statement` cùng kỳ).
 * HMAC SHA-256 over `${timestamp}.${rawBody}` (x-mean-signature, x-mean-timestamp) — mẫu theo
 * app/api/mmp/order-confirmations/route.ts.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { verifyMmpSignature } from '@/features/mmp/hmac';
import { docPayloadMmp } from '@/features/cogs/mmp-payload';
import { apDungBangKeDaDoc } from '@/features/cogs/bang-ke-import';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400 }); }

  const r = docPayloadMmp(json);
  if (!r.ok) return NextResponse.json({ error: r.loi }, { status: 400 });

  const [brand] = await db.select({ slug: schema.mmpBrands.slug }).from(schema.mmpBrands).where(eq(schema.mmpBrands.slug, r.bangKe.brand)).limit(1);
  if (!brand) return NextResponse.json({ error: `Không có brand "${r.bangKe.brand}" trong hệ thống` }, { status: 400 });

  // `ref` chỉ dùng để đặt tên audit (tenFile) — lấy từ chính BangKe đã parse (cột `code`, đổ từ
  // `lines[].ref` trong docPayloadMmp), không đọc lại JSON thô.
  const ref = [...r.bangKe.lines, ...r.bangKe.returns].find((d) => d.code)?.code ?? r.bangKe.period;
  const ket = await apDungBangKeDaDoc({
    brandSlug: r.bangKe.brand, bangKe: [r.bangKe], periods: [r.bangKe.period],
    userId: null, tenFile: `mmp ${ref}`, source: 'mmp',
  });
  if (ket.loi) return NextResponse.json({ error: ket.loi, wroteNothing: true }, { status: 500 });

  const ghi = ket.daGhi[0] ?? { lines: 0, offline: 0, returns: 0 };
  return NextResponse.json({
    period: r.bangKe.period,
    lines: ghi.lines,
    offline: ghi.offline,
    returns: ghi.returns,
    khongKhop: ket.khongKhop.map((k) => ({ orderNumber: k.maDon, sku: k.sku, amount: k.tt, lyDo: k.lyDo })),
  });
}
