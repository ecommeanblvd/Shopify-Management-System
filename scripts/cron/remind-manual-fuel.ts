/**
 * Standalone Railway-friendly cron entry point.
 * Usage: `npm run cron:remind-fuel`
 *
 * REMINDER (not auto-fetch) for carriers whose fuel % has to be entered by
 * hand — currently everything except FedEx/DHL (e.g. UPS, blocked by Akamai
 * scraping protection). Queries every enabled carrier_account whose carrier
 * key is NOT in AUTO_FUEL_CARRIER_KEYS, joins its current fuel_percent
 * surcharge row (if any), and runs the pure `findStaleManualFuel` check
 * (features/carrier-rates/fuel-fetcher/manual-fuel-staleness.ts).
 *
 * This is a NAG, not a failure signal: whether or not stale rows are found,
 * the script exits 0. There is nothing to "fix" automatically — the whole
 * point is a human needs to look up the carrier's published rate and update
 * the row at /f/carrier-rates/{accountId}/surcharges.
 */

import { and, eq, notInArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import {
  findStaleManualFuel,
  AUTO_FUEL_CARRIER_KEYS,
  type ManualFuelRow,
} from '@/features/carrier-rates/fuel-fetcher/manual-fuel-staleness';

async function main(): Promise<void> {
  const accounts = await db
    .select({
      id: schema.carrierAccounts.id,
      name: schema.carrierAccounts.name,
      carrierKey: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        notInArray(schema.carriers.key, [...AUTO_FUEL_CARRIER_KEYS]),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );

  if (accounts.length === 0) {
    process.stdout.write('remind-manual-fuel: no enabled manual-fuel accounts; nothing to do.\n');
    return;
  }

  const fuelRows = await db
    .select({
      carrierAccountId: schema.carrierSurcharges.carrierAccountId,
      value: schema.carrierSurcharges.value,
      updatedAt: schema.carrierSurcharges.updatedAt,
    })
    .from(schema.carrierSurcharges)
    .where(eq(schema.carrierSurcharges.kind, 'fuel_percent'));

  // Pick the most-recently-updated fuel_percent row per account (mirrors
  // "the first active row is canonical" convention from apply.ts, but here
  // we only need to READ the freshest value/timestamp for the reminder).
  const latestByAccount = new Map<string, { value: string; updatedAt: Date }>();
  for (const r of fuelRows) {
    const existing = latestByAccount.get(r.carrierAccountId);
    if (!existing || r.updatedAt > existing.updatedAt) {
      latestByAccount.set(r.carrierAccountId, { value: r.value, updatedAt: r.updatedAt });
    }
  }

  const rows: ManualFuelRow[] = accounts.map((a) => {
    const fuel = latestByAccount.get(a.id);
    return {
      accountId: a.id,
      accountName: a.name,
      carrierKey: a.carrierKey ?? '',
      fuelPercent: fuel ? Number(fuel.value) : null,
      updatedAt: fuel ? fuel.updatedAt : null,
    };
  });

  const staleDays = 7;
  const stale = findStaleManualFuel(rows, new Date(), staleDays);

  if (stale.length === 0) {
    process.stdout.write(`remind-manual-fuel: Tất cả fuel thủ công đã cập nhật trong ${staleDays} ngày.\n`);
    return;
  }

  for (const s of stale) {
    const status = s.reason === 'unset' ? 'unset' : `stale ${s.daysSince} ngày`;
    process.stdout.write(
      `⚠ [${s.carrierKey}] ${s.accountName}: fuel ${status} — cập nhật tại /f/carrier-rates/${s.accountId}/surcharges\n`,
    );
  }
}

main()
  .catch((err) => {
    process.stderr.write(`remind-manual-fuel: fatal: ${err instanceof Error ? err.stack : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    // Drizzle's pg pool holds the process open otherwise.
    process.exit();
  });
