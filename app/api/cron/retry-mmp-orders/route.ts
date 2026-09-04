import { NextResponse } from 'next/server';
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';
import { pushUnsentBrandOrders } from '@/features/mmp/order-backfill';
import { chayJobApi } from '@/features/jobs/api-run';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 500 });
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  try {
    // HAI việc, không phải một: retry chỉ lo dòng pending/failed ĐÃ CÓ, còn đơn
    // CHƯA TỪNG được đẩy thì không có dòng nào nên retry không nhìn thấy. Thiếu
    // vế thứ hai chính là lý do MMP thấy "webhook ngừng từ 04/08" — thực ra nó
    // chưa bao giờ tự chạy, chỉ có người bấm nút (tồn 510 đơn, phát hiện 04/09).
    const r = await chayJobApi('retry-mmp-orders', async () => {
      const retry = await retryFailedMmpPushes();
      const moi = await pushUnsentBrandOrders({ sinceDays: 90 });
      return { retry, moi };
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
