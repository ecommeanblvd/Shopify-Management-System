import { NextResponse } from 'next/server';
import { syncMeanblvdToShopify } from '@/features/warehouse/meanblvd-sync';

import { chayJobApi } from '@/features/jobs/api-run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Đồng bộ tồn kho warehouse → Shopify MEAN BLVD (auto archive/unarchive) cho
 * external HTTPS cron.
 *   GET /api/cron/sync-meanblvd-shopify   (Authorization: Bearer CRON_SECRET)
 * Railway cron service dùng `npm run cron:sync-meanblvd` (không qua HTTP).
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await chayJobApi('sync-meanblvd', () => syncMeanblvdToShopify());
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
