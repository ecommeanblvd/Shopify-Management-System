/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:sync-meanblvd`
 *
 * Đồng bộ tồn kho warehouse → Shopify cho vendor "MEAN BLVD" trên store
 * meanblvd.myshopify.com: set on-hand = sellable, auto archive/unarchive.
 * GHI vào store production.
 *
 * Exit codes: 0 — chạy xong; 1 — có lỗi (item-level hoặc fatal).
 */

import { syncMeanblvdToShopify } from '@/features/warehouse/meanblvd-sync';

async function main(): Promise<void> {
  const s = await syncMeanblvdToShopify();
  process.stdout.write(
    `sync-meanblvd: meanProducts ${s.meanProducts}, inventorySets ${s.inventorySets}, `
    + `archived ${s.archived}, unarchived ${s.unarchived}, errors ${s.errors.length}\n`,
  );
  for (const e of s.errors) process.stderr.write(`sync-meanblvd: ${e}\n`);
  if (s.errors.length) process.exitCode = 1;
}

main()
  .catch((err) => {
    process.stderr.write(`sync-meanblvd: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
