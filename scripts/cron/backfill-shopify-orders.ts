import { runBackfillForStore } from '@/features/shopify-orders/backfill/run-backfill';

async function main(): Promise<void> {
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  if (!storeArg) {
    process.stderr.write('usage: pnpm cron:backfill-orders --store=<storeId>\n');
    process.exit(1);
  }
  const storeId = storeArg.split('=')[1];
  const r = await runBackfillForStore(storeId);
  process.stdout.write(
    `backfill: store=${r.storeId} ingested=${r.ordersIngested} ` +
      `range=${r.filterClause || 'all-history'} duration=${(r.durationMs / 1000).toFixed(1)}s\n`,
  );
}

main()
  .catch((err) => {
    process.stderr.write(`backfill: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
