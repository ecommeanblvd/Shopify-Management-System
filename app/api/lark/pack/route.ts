/**
 * POST /api/lark/pack — Lark Automation gọi khi một dòng LOG-Export đóng xong
 * (Weights · Dimension · Select VTĐG1 · Attachment có, Tracking Number trống).
 * Body { record_id }. SMS đọc lại record và ghi kiện (features/lark/nhan-mot-dong.ts).
 * Mã HTTP theo "Lark có nên thử lại không": 200 mọi kết quả nghiệp vụ, 502 khi Lark API lỗi.
 */
import { NextResponse } from 'next/server';
import {
  kiemTraSecret, docBodyPack, GIOI_HAN_BODY, moTaTuChoi, nenGhiTuChoi, CUA_SO_TU_CHOI_PHUT,
  type MoTaTuChoi,
} from '@/features/lark/pack-webhook/xac-thuc';
import { nhanTheoNhanDien, LoiLarkApi } from '@/features/lark/nhan-mot-dong';
import { batDauJob, ketThucJob } from '@/features/jobs/record';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';

/**
 * Ghi một lượt BỊ TỪ CHỐI vào nhật ký (08/10/2026).
 *
 * Trước đây route trả lỗi trước khi mở nhật ký, nên cú gọi sai secret không để lại dấu nào —
 * và Lark Automation chạy đều, báo Success suốt 16 ngày trong khi SMS có đúng 0 dòng. "Không có
 * dữ liệu" trông y hệt "không ai gọi", nên không ai kết luận được gì.
 *
 * Best-effort: ghi nhật ký hỏng KHÔNG được đổi phản hồi trả về cho Lark.
 */
async function ghiTuChoi(mo: MoTaTuChoi): Promise<void> {
  try {
    const [d] = (await db.execute(sql`
      select count(*)::int as n from job_runs
      where job_key = 'lark-pack-webhook' and status <> 'ok'
        and started_at > now() - (${CUA_SO_TU_CHOI_PHUT} || ' minutes')::interval
    `)).rows as { n: number }[];
    if (!nenGhiTuChoi(d?.n ?? 0)) {
      console.warn('[lark-pack] bỏ qua ghi từ chối — đã quá trần trong cửa sổ:', mo.tuChoi);
      return;
    }
    const jobId = await batDauJob('lark-pack-webhook');
    await ketThucJob(jobId, {
      ok: false,
      error: `TỪ CHỐI ${mo.tuChoi}: ${mo.loi}`.slice(0, 2000),
      summary: mo,
      batDau: Date.now(),
    });
  } catch (e) {
    console.error('[lark-pack] ghi từ chối lỗi:', e);
  }
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const header = req.headers.get('x-lark-pack-secret');
  const secret = process.env.LARK_PACK_WEBHOOK_SECRET;
  const chung = {
    header, secret,
    contentLength: req.headers.get('content-length'),
    userAgent: req.headers.get('user-agent'),
  };

  const xt = kiemTraSecret(header, secret);
  if (!xt.ok) {
    await ghiTuChoi(moTaTuChoi({ ...chung, tuChoi: 'secret', loi: xt.error }));
    return NextResponse.json({ error: xt.error }, { status: xt.status });
  }
  // Chặn theo Content-Length TRƯỚC khi đọc body — không đệm cả request lớn vào RAM rồi mới từ chối.
  if (Number(req.headers.get('content-length') ?? 0) > GIOI_HAN_BODY) {
    await ghiTuChoi(moTaTuChoi({ ...chung, tuChoi: 'qua-lon', loi: 'body quá 4KB' }));
    return NextResponse.json({ error: 'body quá 4KB' }, { status: 413 });
  }
  const body = docBodyPack(await req.text());
  if (!body.ok) {
    await ghiTuChoi(moTaTuChoi({ ...chung, tuChoi: 'body', loi: body.error }));
    return NextResponse.json({ error: body.error }, { status: body.status });
  }

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
