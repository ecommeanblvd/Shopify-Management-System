/**
 * HTTP endpoint chạy đồng bộ đơn mỗi giờ cho mọi store active (lưới an toàn sau
 * webhook): kéo các đơn updated_at >= lastCronSyncAt qua GraphQL và upsert.
 *
 * Đường cron chính trên Railway dùng script `scripts/cron/sync-shopify-orders.ts`
 * (`npm run cron:sync-orders`). Route HTTP này để:
 *   1. Provider cron HTTPS (cron-job.org, EasyCron, GitHub Actions schedule).
 *   2. Force-sync thủ công bằng curl + bearer token.
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://<railway-url>/api/cron/sync-orders
 *
 * Response: { ok: true, ran, results: [{ storeId, storeName, ingested, error? }] }
 */
import { NextResponse } from 'next/server';
import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';

import { chayJobApi } from '@/features/jobs/api-run';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Đồng bộ nhiều store có thể lâu — nới trần thời gian chạy.
export const maxDuration = 300;

export async function GET(request: Request): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 500 },
    );
  }
  const authHeader = request.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  try {
    const results = await chayJobApi('sync-orders', () => runHourlySync());
    return NextResponse.json({ ok: true, ran: results.length, results });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
