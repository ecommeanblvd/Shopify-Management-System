/**
 * POST /api/lark/pack — Lark Automation gọi khi một dòng LOG-Export đóng xong
 * (Weights · Dimension · Select VTĐG1 · Attachment có, Tracking Number trống).
 * Body { record_id }. SMS đọc lại record và ghi kiện (features/lark/nhan-mot-dong.ts).
 * Mã HTTP theo "Lark có nên thử lại không": 200 mọi kết quả nghiệp vụ, 502 khi Lark API lỗi.
 */
import { NextResponse } from 'next/server';
import { kiemTraSecret, docBodyPack, GIOI_HAN_BODY } from '@/features/lark/pack-webhook/xac-thuc';
import { nhanTheoNhanDien, LoiLarkApi } from '@/features/lark/nhan-mot-dong';
import { batDauJob, ketThucJob } from '@/features/jobs/record';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const xt = kiemTraSecret(req.headers.get('x-lark-pack-secret'), process.env.LARK_PACK_WEBHOOK_SECRET);
  if (!xt.ok) return NextResponse.json({ error: xt.error }, { status: xt.status });
  // Chặn theo Content-Length TRƯỚC khi đọc body — không đệm cả request lớn vào RAM rồi mới từ chối.
  if (Number(req.headers.get('content-length') ?? 0) > GIOI_HAN_BODY) return NextResponse.json({ error: 'body quá 4KB' }, { status: 413 });
  const body = docBodyPack(await req.text());
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });

  const dry = process.env.LARK_PACK_DRY === '1';
  const batDau = Date.now();
  const jobId = await batDauJob('lark-pack-webhook');
  try {
    const ds = await nhanTheoNhanDien(body.nhanDien, { dry });
    const ms = Date.now() - batDau;
    const chung = { nhanDien: body.nhanDien, soDong: ds.length, dry, ms };
    await ketThucJob(jobId, { ok: true, summary: { ...chung, ketQua: ds }, batDau });
    // Một dòng thì trả thẳng cho dễ đọc; nhiều dòng (đơn tách kiện) thì trả cả mảng.
    return NextResponse.json(ds.length === 1 ? { ...ds[0], ...chung } : { ...chung, ketQua: ds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ketThucJob(jobId, { ok: false, error: `${body.nhanDien.kieu}=${body.nhanDien.giaTri}: ${msg}`.slice(0, 2000), batDau });
    // Chi tiết lỗi nằm ở job_runs; ra ngoài chỉ nói Lark có nên thử lại không (không lộ thông tin nội bộ).
    return e instanceof LoiLarkApi
      ? NextResponse.json({ error: 'Lark API lỗi, hãy thử lại' }, { status: 502 })
      : NextResponse.json({ error: 'lỗi hệ thống, xem job_runs lark-pack-webhook' }, { status: 500 });
  }
}
