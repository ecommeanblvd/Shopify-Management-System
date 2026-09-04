import { NextResponse } from 'next/server';
import { refreshVcbFx } from '@/features/carrier-rates/fx/refresh-vcb';

import { chayJobApi } from '@/features/jobs/api-run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Cập nhật tỉ giá VCB (USD→VND) cho account lưu giá USD — external HTTPS cron.
 *   GET /api/cron/refresh-vcb-fx  (Authorization: Bearer CRON_SECRET)
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  try {
    const r = await chayJobApi('refresh-vcb-fx', () => refreshVcbFx());
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
