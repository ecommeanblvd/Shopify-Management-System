import { NextResponse } from 'next/server';
import { syncWarehouseFromLark } from '@/features/warehouse/lark-sync';

import { chayJobApi } from '@/features/jobs/api-run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Đối soát tồn kho Lark → SMS cho external HTTPS cron.
 *   GET /api/cron/sync-warehouse   (Authorization: Bearer CRON_SECRET)
 * Railway cron service dùng `npm run cron:sync-warehouse` (không qua HTTP).
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await chayJobApi('sync-warehouse', () => syncWarehouseFromLark());
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
