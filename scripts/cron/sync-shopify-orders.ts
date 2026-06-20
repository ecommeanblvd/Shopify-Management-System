import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';
import { retryFailedMmpPushes } from '@/features/mmp/order-push-retry';

async function main(): Promise<void> {
  const results = await runHourlySync();
  let failures = 0;
  for (const r of results) {
    if (r.error) {
      failures++;
      process.stderr.write(`sync-orders: ${r.storeName} — FAILED: ${r.error}\n`);
    } else {
      process.stdout.write(`sync-orders: ${r.storeName} — ${r.ingested} orders\n`);
    }
  }
  if (failures > 0) process.exitCode = 1;
  try {
    const mmp = await retryFailedMmpPushes();
    process.stdout.write(`retry-mmp: retried ${mmp.retried}, recovered ${mmp.recovered}, stillFailing ${mmp.stillFailing}\n`);
  } catch (e) {
    process.stderr.write(`retry-mmp: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

main()
  .catch((err) => {
    process.stderr.write(`sync-orders: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
