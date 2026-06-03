/**
 * One-off backfill: pull the last 13 weeks of FedEx Vietnam fuel
 * surcharges from FedEx's own AEM service and time-version them into
 * carrier_surcharges using the existing starts_at/ends_at windowing.
 *
 * Mirrors the manual DHL backfill that landed alongside #106 — same
 * "close the open row, prepend historical closed rows" pattern, but
 * fully derived from FedEx's published week ranges rather than
 * computed ISO weeks.
 *
 * Idempotent enough: drops every FedEx fuel_percent row first and
 * re-seeds the table with the 13-week history + the current open row.
 * Operator-edited notes on the open row will be reseeded with a
 * standard note — that's fine for the one-off run.
 *
 * Usage (with Railway env vars exported):
 *   pnpm tsx scripts/backfill-fedex-historical-fuel.ts
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { fetchFedExFuelPercent } from '@/features/carrier-rates/fuel-fetcher/fedex';

const FEDEX_CARRIER_KEY = 'fedex';

async function main(): Promise<void> {
  const accounts = await db
    .select({ id: schema.carrierAccounts.id, name: schema.carrierAccounts.name })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        eq(schema.carriers.key, FEDEX_CARRIER_KEY),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );
  if (accounts.length === 0) {
    process.stdout.write('No enabled FedEx accounts; nothing to do.\n');
    return;
  }

  // Pull the 13-week history once. Every FedEx account in the system
  // uses the same APAC/VN rate sheet so a single fetch covers them all.
  process.stdout.write('Fetching 13 weeks of FedEx fuel from AEM...\n');
  const fetched = await fetchFedExFuelPercent({ numOfRecords: 13 });
  // FedEx returns rows newest-first. Sort ascending so we can iterate
  // and close each window cleanly against the next row's start.
  const rows = [...fetched.rows].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
  process.stdout.write(`  → ${rows.length} weeks, oldest = ${rows[0].weekRaw}, newest = ${rows[rows.length - 1].weekRaw}\n`);

  for (const account of accounts) {
    process.stdout.write(`\nBackfilling ${account.name} (${account.id})\n`);

    // Wipe every fuel_percent row first. We're rebuilding the history
    // from scratch — safer than trying to merge with whatever's there.
    const deleted = await db
      .delete(schema.carrierSurcharges)
      .where(
        and(
          eq(schema.carrierSurcharges.carrierAccountId, account.id),
          eq(schema.carrierSurcharges.kind, 'fuel_percent'),
        ),
      )
      .returning({ id: schema.carrierSurcharges.id });
    process.stdout.write(`  Removed ${deleted.length} existing fuel_percent row(s)\n`);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const isOpen = i === rows.length - 1;
      // Close window at the NEXT row's startsAt so adjacent weeks meet
      // exactly. The newest row stays open (endsAt = NULL).
      const startsAt = new Date(Date.UTC(
        row.effectiveFrom.getUTCFullYear(),
        row.effectiveFrom.getUTCMonth(),
        row.effectiveFrom.getUTCDate(),
      ));
      const endsAt = isOpen
        ? null
        : new Date(Date.UTC(
            rows[i + 1].effectiveFrom.getUTCFullYear(),
            rows[i + 1].effectiveFrom.getUTCMonth(),
            rows[i + 1].effectiveFrom.getUTCDate(),
          ));
      const noteBody = isOpen
        ? `FedEx Air fuel — ${row.weekRaw} (current, auto-refreshed weekly via cron)`
        : `FedEx Air fuel — ${row.weekRaw} (backfilled from fedex.com AEM)`;
      await db.insert(schema.carrierSurcharges).values({
        carrierAccountId: account.id,
        kind: 'fuel_percent',
        value: row.percent.toString(),
        active: true,
        startsAt,
        endsAt,
        note: noteBody,
        lastAutoFetchedAt: isOpen ? fetched.fetchedAt : null,
        lastAutoSource: `fedex/${row.weekRaw}`,
      });
      const tag = isOpen ? 'OPEN' : 'CLOSED';
      process.stdout.write(`  [${tag}] ${row.weekRaw} → ${row.percent}%\n`);
    }
  }
  process.stdout.write('\nDone.\n');
}

main()
  .catch((err) => {
    process.stderr.write(`backfill-fedex-historical-fuel: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
