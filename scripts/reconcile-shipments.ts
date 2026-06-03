/**
 * One-off: reconcile imported shipment_charges against the engine
 * and print a sorted delta table.
 *
 *   pnpm exec tsx scripts/reconcile-shipments.ts \
 *     [--carrier=fedex|dhl] [--top=N] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 */

import { reconcileShipments } from '@/features/shipments/reconcile';

function arg(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found ? found.split('=', 2)[1] : undefined;
}

function vnd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const formatted = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.abs(n));
  return (n < 0 ? '-' : '') + formatted;
}

async function main(): Promise<void> {
  const carrier = arg('carrier') as 'fedex' | 'dhl' | undefined;
  const topN = Number(arg('top') ?? '50');
  const from = arg('from') ? new Date(arg('from')!) : undefined;
  const to = arg('to') ? new Date(arg('to')!) : undefined;

  process.stdout.write(`Reconciling${carrier ? ` (carrier=${carrier})` : ''}…\n\n`);

  const r = await reconcileShipments({ carrierKey: carrier, fromDate: from, toDate: to, topN });

  process.stdout.write(`=== Summary ===\n`);
  process.stdout.write(`  Total shipments:      ${r.totalShipments}\n`);
  process.stdout.write(`  Engine matched:       ${r.matched}\n`);
  process.stdout.write(`  Engine unmatched:     ${r.unmatched}\n`);
  process.stdout.write(`  Σ Billed:             ${vnd(r.totals.billed).padStart(16)} VND\n`);
  process.stdout.write(`  Σ Engine:             ${vnd(r.totals.engine).padStart(16)} VND\n`);
  process.stdout.write(`  Δ Billed − Engine:    ${vnd(r.totals.deltaVnd).padStart(16)} VND  (${r.totals.deltaPct.toFixed(2)} %)\n`);

  process.stdout.write(`\n=== Top ${topN} rows by |Δ| ===\n`);
  process.stdout.write(`${'order'.padEnd(14)} ${'tracking'.padEnd(13)} ${'cc'.padEnd(3)} ${'ctry'.padEnd(4)} ${'kg'.padStart(5)} ${'billed'.padStart(11)} ${'engine'.padStart(11)} ${'delta'.padStart(11)} ${'Δ%'.padStart(7)}  reason\n`);
  process.stdout.write(`${'-'.repeat(120)}\n`);
  for (const row of r.rows) {
    const dt = row.deltaPct !== null ? `${row.deltaPct.toFixed(1)}` : '—';
    process.stdout.write(
      `${row.orderNumber.padEnd(14)} ${row.trackingNumber.padEnd(13)} ${row.carrierKey.padEnd(3)} ${row.shipCountry.padEnd(4)} ${String(row.weightKg ?? '—').padStart(5)} ${vnd(row.billedTotal).padStart(11)} ${vnd(row.engineTotal).padStart(11)} ${vnd(row.deltaVnd).padStart(11)} ${dt.padStart(7)}  ${row.engineReason ?? ''}\n`,
    );
  }
}

main()
  .catch((err) => {
    process.stderr.write(`reconcile: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
