import { NextResponse } from 'next/server';
import { trackPendingShipments } from '@/features/shipments/track';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Poll trạng thái giao hàng (FedEx + DHL) cho external HTTPS cron.
 *   GET /api/cron/track-shipments   (Authorization: Bearer CRON_SECRET)
 * Railway cron service dùng `npm run cron:track-shipments` (không qua HTTP).
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await trackPendingShipments({ limit: 200 });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
