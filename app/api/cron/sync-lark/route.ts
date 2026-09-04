import { NextResponse } from 'next/server';
import { syncLarkPacks } from '@/features/lark/sync';
import { syncBrandReceived } from '@/features/lark/sync-brand-received';

import { chayJobApi } from '@/features/jobs/api-run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await chayJobApi('sync-lark', () => syncLarkPacks());
    // Ngày MEAN nhận hàng từ brand (nguồn receivedAt cho MMP). Best-effort —
    // lỗi KHÔNG chặn kết quả sync logistics.
    let brandReceived: Awaited<ReturnType<typeof syncBrandReceived>> | { error: string };
    try { brandReceived = await syncBrandReceived(); }
    catch (e) { brandReceived = { error: e instanceof Error ? e.message : String(e) }; console.error('[lark] syncBrandReceived lỗi:', e); }
    return NextResponse.json({ ok: true, ...summary, brandReceived });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
