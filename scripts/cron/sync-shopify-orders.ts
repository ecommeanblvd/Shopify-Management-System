import { runHourlySync } from '@/features/shopify-orders/cron/hourly-sync';

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
}

main()
  .catch((err) => {
    process.stderr.write(`sync-orders: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
