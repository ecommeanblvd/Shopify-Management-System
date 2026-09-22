/**
 * POST /api/lark/pack — Lark Automation gọi khi một dòng LOG-Export đóng xong
 * (Weights · Dimension · Select VTĐG1 · Attachment có, Tracking Number trống).
 * Body { record_id }. SMS đọc lại record và ghi kiện (features/lark/nhan-mot-dong.ts).
 * Mã HTTP theo "Lark có nên thử lại không": 200 mọi kết quả nghiệp vụ, 502 khi Lark API lỗi.
 */
import { NextResponse } from 'next/server';
import { kiemTraSecret, docBodyPack } from '@/features/lark/pack-webhook/xac-thuc';
import { nhanMotDongLark, LoiLarkApi } from '@/features/lark/nhan-mot-dong';
import { batDauJob, ketThucJob } from '@/features/jobs/record';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const xt = kiemTraSecret(req.headers.get('x-lark-pack-secret'), process.env.LARK_PACK_WEBHOOK_SECRET);
  if (!xt.ok) return NextResponse.json({ error: xt.error }, { status: xt.status });
  const body = docBodyPack(await req.text());
  if (!body.ok) return NextResponse.json({ error: body.error }, { status: body.status });

  const dry = process.env.LARK_PACK_DRY === '1';
  const batDau = Date.now();
  const jobId = await batDauJob('lark-pack-webhook');
  try {
    const kq = await nhanMotDongLark(body.recordId, { dry });
    const ms = Date.now() - batDau;
    await ketThucJob(jobId, { ok: true, summary: { recordId: body.recordId, logCodeTuLark: body.logUniqueCode, ...kq, dry, ms }, batDau });
    return NextResponse.json({ ...kq, dry, ms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await ketThucJob(jobId, { ok: false, error: `${body.recordId}: ${msg}`.slice(0, 2000), batDau });
    const status = e instanceof LoiLarkApi ? 502 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
