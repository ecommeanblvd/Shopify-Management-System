/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:sync-lifecycle`
 *
 * Đối chiếu tín hiệu nguồn → upsert order_lifecycle (stage + mốc + SLA delay).
 * Lần chạy đầu = backfill đơn ≤120 ngày. Lỗi từng đơn không abort batch.
 *
 * Exit codes: 0 — chạy xong; 1 — lỗi fatal.
 */

import { syncOrderLifecycle } from '@/features/lifecycle/sync';

import { chayCron } from '@/features/jobs/run';
async function main(): Promise<void> {
  const s = await syncOrderLifecycle();
  process.stdout.write(
    `sync-lifecycle: scanned ${s.scanned}, upserted ${s.upserted}, errors ${s.errors.length}\n`,
  );
  for (const e of s.errors.slice(0, 10)) process.stderr.write(`  ${e}\n`);
}

chayCron('sync-lifecycle', main);
