/**
 * Pure staleness check for carriers WITHOUT an auto-fetcher (e.g. UPS —
 * blocked by Akamai scraping protection, unlike FedEx/DHL which have
 * `fedex.ts` / `dhl.ts` fetchers wired into `apply.ts`).
 *
 * These carriers' `fuel_percent` surcharge is entered by hand at
 * `/f/carrier-rates/[id]/surcharges`. Nothing keeps it fresh automatically,
 * so we need a REMINDER mechanism: a weekly cron that flags accounts whose
 * fuel % was never set, or hasn't been touched in `staleDays` days, so an
 * operator goes and checks the carrier's published rate.
 *
 * Kept carrier-agnostic and DB-agnostic (pure function over plain rows) so
 * it's trivially unit-testable — the cron script and the admin page banner
 * both call this with rows they've already queried.
 */

/** Carrier keys that have a working auto-fetch scraper (see `apply.ts`).
 *  Everything else is manual-fuel and eligible for the staleness reminder. */
export const AUTO_FUEL_CARRIER_KEYS = ['fedex', 'dhl'] as const;

export interface ManualFuelRow {
  accountId: string;
  accountName: string;
  carrierKey: string;
  fuelPercent: number | null;
  updatedAt: Date | null;
}

export interface StaleFuel extends ManualFuelRow {
  reason: 'unset' | 'stale';
  daysSince: number | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Filter manual-fuel carrier rows (carrier key NOT in `AUTO_FUEL_CARRIER_KEYS`)
 * down to the ones that need an operator's attention:
 *   - `fuelPercent` is null or 0 → 'unset' (never configured, or blanked out).
 *   - `updatedAt` is more than `staleDays` days before `now` → 'stale'.
 *
 * Rows for auto-fetch carriers (fedex/dhl) are always skipped — those are
 * kept fresh by the cron-driven scraper in `apply.ts`, so nagging about them
 * here would just be noise.
 */
export function findStaleManualFuel(
  rows: ManualFuelRow[],
  now: Date,
  staleDays = 7,
): StaleFuel[] {
  const autoKeys = new Set<string>(AUTO_FUEL_CARRIER_KEYS);
  const result: StaleFuel[] = [];

  for (const row of rows) {
    if (autoKeys.has(row.carrierKey)) continue;

    const isUnset = row.fuelPercent === null || row.fuelPercent === 0;
    if (isUnset) {
      result.push({ ...row, reason: 'unset', daysSince: null });
      continue;
    }

    if (row.updatedAt === null) {
      // Fuel is set but we have no updatedAt to judge staleness — shouldn't
      // happen in practice (the surcharge row always has updatedAt), but
      // treat conservatively as unset rather than silently skipping.
      result.push({ ...row, reason: 'unset', daysSince: null });
      continue;
    }

    const daysSince = Math.floor((now.getTime() - row.updatedAt.getTime()) / MS_PER_DAY);
    if (daysSince > staleDays) {
      result.push({ ...row, reason: 'stale', daysSince });
    }
  }

  return result;
}
