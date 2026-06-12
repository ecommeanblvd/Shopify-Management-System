/**
 * Pure transform: parsed FedEx demand periods → time-windowed config rows.
 *
 * The reconcile bug this fixes: the live config stores untimed demand rows
 * (e.g. Israel 28400 for ALL time), but the FedEx Demand Surcharge is
 * per-period — Israel was 11200 VND/kg in Jul–Sep 2025 and only became 28400
 * recently. `buildDemandRows` turns the periods into non-overlapping windows so
 * the engine charges the right rate for the shipment's date.
 */

import type { DemandPeriod } from './parse';
import { regionToCountries } from './regions';

export interface DemandRowSpec {
  countryCodes: string[];
  valueVndPerKg: number;
  startsAt: Date;
  endsAt: Date | null;
  regionKey: string;
}

/** Periods (any order) → time-windowed demand rows, no overlap.
 *  A period with effectiveTo=null (NEW format) gets endsAt = the effectiveFrom
 *  of the NEXT period chronologically (or null if it's the latest).
 *  A period with effectiveTo set (OLD format) keeps it.
 *  Regions that don't map (regionToCountries → []) are skipped and collected. */
export function buildDemandRows(
  periods: DemandPeriod[],
): { rows: DemandRowSpec[]; unmappedRegions: string[] } {
  const sorted = [...periods].sort(
    (a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime(),
  );
  const rows: DemandRowSpec[] = [];
  const unmapped = new Set<string>();
  sorted.forEach((p, i) => {
    const end = p.effectiveTo ?? (i + 1 < sorted.length ? sorted[i + 1].effectiveFrom : null);
    for (const [regionKey, value] of Object.entries(p.exportRates)) {
      const countryCodes = regionToCountries(regionKey);
      if (countryCodes.length === 0) {
        unmapped.add(regionKey);
        continue;
      }
      rows.push({ countryCodes, valueVndPerKg: value, startsAt: p.effectiveFrom, endsAt: end, regionKey });
    }
  });
  return { rows, unmappedRegions: [...unmapped] };
}
