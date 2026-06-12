/**
 * One-off CLI: import the operator's LOG-Export Excel into
 * shipments + shipment_charges. Idempotent — re-running with the
 * same file is a no-op on already-imported rows.
 *
 *   pnpm exec tsx scripts/import-ops-xlsx.ts <path-to.xlsx> [--dry-run]
 */

import { read, utils } from 'xlsx';
import { readFileSync } from 'fs';
import { importLogExport } from '@/features/shipments/import-actions';
import type { Cell, RawRow } from '@/features/shipments/parse-xlsx-row';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write('usage: tsx scripts/import-ops-xlsx.ts <xlsx> [--dry-run]\n');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');

  process.stdout.write(`Reading ${path}…\n`);
  const wb = read(readFileSync(path), { type: 'buffer', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const allRows = utils.sheet_to_json<Cell[]>(ws, { defval: null, header: 1, raw: true });
  // Skip the header row.
  const dataRows: RawRow[] = allRows.slice(1);
  process.stdout.write(`${dataRows.length} data rows\n`);
  process.stdout.write(dryRun ? '⚠ DRY RUN — no DB writes\n\n' : '\n');

  const summary = await importLogExport(dataRows, { dryRun, header: allRows[0] });

  process.stdout.write(`\n=== Import summary (${(summary.durationMs / 1000).toFixed(1)}s) ===\n`);
  process.stdout.write(`  Total rows:        ${summary.totalRows.toString().padStart(6)}\n`);
  process.stdout.write(`  Parsed valid:      ${summary.parsed.toString().padStart(6)}\n`);
  process.stdout.write(`  Imported (new):    ${summary.imported.toString().padStart(6)}\n`);
  process.stdout.write(`  Updated (in place):${summary.updated.toString().padStart(6)}\n`);
  process.stdout.write(`  Already imported:  ${summary.alreadyImported.toString().padStart(6)}\n`);
  process.stdout.write(`\n  --- Skipped ---\n`);
  for (const [k, v] of Object.entries(summary.skipped)) {
    process.stdout.write(`  ${k.padEnd(22)} ${v.toString().padStart(5)}\n`);
  }
  if (summary.warnings.orphan_orders.length > 0) {
    process.stdout.write(`\n  --- Orphan orders (${summary.warnings.orphan_orders.length}) ---\n`);
    for (const o of summary.warnings.orphan_orders.slice(0, 20)) {
      process.stdout.write(`  ${o}\n`);
    }
    if (summary.warnings.orphan_orders.length > 20) {
      process.stdout.write(`  … and ${summary.warnings.orphan_orders.length - 20} more\n`);
    }
  }
  if (summary.warnings.errors.length > 0) {
    process.stdout.write(`\n  --- Errors (${summary.warnings.errors.length}) ---\n`);
    for (const e of summary.warnings.errors.slice(0, 10)) {
      process.stdout.write(`  row ${e.rowIndex + 2}: ${e.reason}\n`);
    }
  }
}

main()
  .catch((err) => {
    process.stderr.write(`import-ops-xlsx: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
