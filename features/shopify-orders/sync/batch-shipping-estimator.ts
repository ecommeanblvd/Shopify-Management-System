/**
 * Batched alternative to `resolveShippingEstimate` for the orders
 * dashboard, which calls it once per order. The naïve per-order path
 * runs SQL plus one full carrier-account snapshot load per order, so a
 * single 90-day window for a busy store can fan out into thousands of
 * DB roundtrips.
 *
 * Strategy (per operator spec, 2026-06-03):
 *   1. Load every enabled carrier account ONCE, grouped by carrier_key
 *      ('fedex' | 'dhl' | …) plus a flat snapshot map.
 *   2. `estimate({ shipCountry, shipWeightKg, shippingCarrierKey })`
 *      picks the snapshot group matching the order's carrier key
 *      (defaulting to FedEx when no shipping line was detected) and
 *      quotes against ONLY that group. Never picks cheapest across
 *      carriers — that mis-attributes cost when DHL was the real ship.
 *   3. Memoise by (country, weight, week, carrierKey) so orders sharing
 *      the same shape pay one quote computation.
 *
 * Result envelope matches `resolveShippingEstimate` so the call sites
 * remain interchangeable.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

/** What the estimator falls back to when the order has no detectable
 *  shipping line (Shopify dropped it, free/manual fulfilment, pickup).
 *  Operator-confirmed every store routes to FedEx by default. */
const DEFAULT_CARRIER_KEY = 'fedex';

/** Returns the UTC midnight epoch of the Monday-anchored ISO week the
 *  date falls in. Used as a memo key so orders shipped in the same week
 *  reuse the same engine quote — fuel% changes weekly. */
function mondayUtcMs(d: Date): number {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: Sun=0..Sat=6; ISO week starts on Monday (=1). Convert to
  // 0..6 with Mon=0.
  const dow = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - dow);
  return day.getTime();
}

export interface EngineEstimateInput {
  shipCountry: string | null;
  /** Postcode/ZIP — used to match ODA tier for FedEx/DHL remote
   *  surcharges. NULL when missing. */
  shipPostcode?: string | null;
  shipWeightKg: number | null;
  /**
   * Effective quote date — defaults to "now". Pass the order's
   * `processed_at_shopify` so fuel-surcharge time-versioning resolves
   * to the rate sheet from the order's ship week.
   */
  effectiveDate?: Date;
  /**
   * Carrier key pinned per order, derived from the Shopify shipping
   * line ('fedex' | 'dhl' | …). NULL → falls back to FedEx and the
   * result carries `fallback: true` so the UI can flag implicit
   * attribution. NEVER auto-pick the cheapest carrier.
   */
  shippingCarrierKey?: string | null;
}

/**
 * Why an order's shipping cost couldn't be priced by the carrier engine.
 * Surfaced in the dashboard so the operator can see the root cause and
 * fix it at the source (set variant weights, configure a carrier, etc.)
 * instead of guessing.
 */
export type EngineEstimateReason =
  | 'no_country'           // order has no shipping country (pickup, digital, etc.)
  | 'no_weight'            // order has no chargeable weight on its line items
  | 'no_carrier_accounts'  // no enabled carrier accounts match the order's carrier key
  | 'no_quote';            // carrier exists but couldn't produce a tier-+zone-matched quote

export interface EngineEstimateResult {
  /** Carrier cost in the carrier's DISPLAY currency (typically the order
   *  currency, e.g. USD). Derived via `carrierCost / fxCostPerDisplay`. */
  amount: number;
  /** Carrier cost in the carrier's COST currency (e.g. VND). Raw integer
   *  from the rate sheet + surcharges — no FX round-trip. The dashboard
   *  uses it for cost-currency display so the operator sees the same VND
   *  number the engine actually computed (and the carrier will invoice),
   *  not a re-derived value. */
  costAmount: number;
  /** ISO-3 code of `costAmount`'s currency. */
  costCurrency: string;
  source: 'engine_estimate' | 'unknown';
  /** Present only when `source === 'unknown'`. */
  reason?: EngineEstimateReason;
  /** True when the order had no detectable shipping line and we routed
   *  through the DEFAULT_CARRIER_KEY (FedEx). UI uses this to flag
   *  implicit attribution. */
  fallback?: boolean;
}

export interface BatchShippingEstimator {
  estimate(input: EngineEstimateInput): EngineEstimateResult;
}

/**
 * Pre-warms every piece of carrier data a dashboard render might need,
 * then exposes a synchronous `estimate()` that's pure compute.
 */
export async function createBatchShippingEstimator(): Promise<BatchShippingEstimator> {
  // Every enabled carrier account joined to its parent carrier brand,
  // so we can group snapshots by carrier_key ('fedex' | 'dhl' | …).
  const accountRows = await db
    .select({
      id: schema.carrierAccounts.id,
      carrierKey: schema.carriers.key,
    })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(eq(schema.carrierAccounts.enabled, true));

  // Parallel snapshot load — total wait is one snapshot, not N.
  const snapshotEntries = await Promise.all(
    accountRows.map(async (row): Promise<[string, string | null, CarrierAccountSnapshot | null]> => {
      return [row.id, row.carrierKey, await loadAccountSnapshot(row.id)];
    }),
  );

  // Carrier key → list of snapshots that quote under that key. Multiple
  // FedEx contracts can coexist (e.g. store-A vs store-B rate sheets);
  // we try each and keep the cheapest within the SAME key.
  const snapshotsByKey = new Map<string, CarrierAccountSnapshot[]>();
  for (const [, key, snap] of snapshotEntries) {
    if (!snap || !key) continue;
    const arr = snapshotsByKey.get(key) ?? [];
    arr.push(snap);
    snapshotsByKey.set(key, arr);
  }
  // Reference `and` so the import stays in case future code wants
  // compound filters again. Cheap, lints clean.
  void and;

  // Per-(country, weight, week, carrierKey) memo. Many orders in a
  // window share a small handful of (country, weight, carrier) tuples
  // once weight is rounded.
  const memo = new Map<string, EngineEstimateResult>();

  /**
   * Cheapest successful quote across the snapshots registered for one
   * carrier key. "Cheapest within carrier" is fine — those represent
   * different contracts under the same brand, not different brands.
   */
  function bestQuoteWithinCarrier(
    snaps: readonly CarrierAccountSnapshot[],
    country: string,
    weightKg: number,
    effectiveDate?: Date,
    destinationPostcode?: string | null,
  ): { display: number; cost: number; costCurrency: string } | null {
    let best: { display: number; cost: number; costCurrency: string } | null = null;
    for (const snap of snaps) {
      const q = quote(snap, {
        weightKg,
        destinationCountry: country,
        destinationPostcode: destinationPostcode ?? undefined,
        effectiveDate,
      });
      if (!q.ok) continue;
      const display = q.breakdown.carrierCostDisplay;
      if (best === null || display < best.display) {
        best = {
          display,
          cost: q.breakdown.carrierCost,
          costCurrency: snap.costCurrency,
        };
      }
    }
    return best;
  }

  return {
    estimate(input: EngineEstimateInput): EngineEstimateResult {
      // Country and weight come from `shipping_address.country_code_v2`
      // and `total_weight` on the Shopify order respectively. Either
      // missing means the order can't even start a quote — surface why.
      if (!input.shipCountry) {
        return { amount: 0, costAmount: 0, costCurrency: '', source: 'unknown', reason: 'no_country' };
      }
      if (!input.shipWeightKg || input.shipWeightKg <= 0) {
        return { amount: 0, costAmount: 0, costCurrency: '', source: 'unknown', reason: 'no_weight' };
      }

      const carrierKey = input.shippingCarrierKey?.trim().toLowerCase() || DEFAULT_CARRIER_KEY;
      const isFallback = !input.shippingCarrierKey;

      // Round weight to 3 dp so micro-fluctuations don't bust the memo;
      // the rate matrix only changes on tier boundaries anyway. The
      // effectiveDate bucket is the order's UTC week (Mon midnight) so
      // many orders shipped the same week share one memo entry — fuel %
      // only changes weekly, so finer granularity doesn't pay off. The
      // carrier key is part of the key so two FedEx-vs-DHL orders at the
      // same country/weight don't collide.
      const wKey = Math.round(input.shipWeightKg * 1000) / 1000;
      const dKey = input.effectiveDate ? mondayUtcMs(input.effectiveDate) : 'now';
      const pKey = input.shipPostcode?.trim() || '-';
      const key = `${carrierKey}|${input.shipCountry}|${pKey}|${wKey}|${dKey}`;
      const cached = memo.get(key);
      if (cached) return cached;

      const snaps = snapshotsByKey.get(carrierKey);
      if (!snaps || snaps.length === 0) {
        const r: EngineEstimateResult = {
          amount: 0, costAmount: 0, costCurrency: '',
          source: 'unknown', reason: 'no_carrier_accounts',
          fallback: isFallback || undefined,
        };
        memo.set(key, r);
        return r;
      }

      const best = bestQuoteWithinCarrier(
        snaps,
        input.shipCountry,
        input.shipWeightKg,
        input.effectiveDate,
        input.shipPostcode ?? null,
      );
      if (best !== null) {
        const r: EngineEstimateResult = {
          amount: best.display,
          costAmount: best.cost,
          costCurrency: best.costCurrency,
          source: 'engine_estimate',
          fallback: isFallback || undefined,
        };
        memo.set(key, r);
        return r;
      }

      // The carrier exists but couldn't quote this destination/weight.
      // Usually means the country isn't in any of its zones, or the
      // weight overflows the last tier.
      const r: EngineEstimateResult = {
        amount: 0, costAmount: 0, costCurrency: '',
        source: 'unknown', reason: 'no_quote',
        fallback: isFallback || undefined,
      };
      memo.set(key, r);
      return r;
    },
  };
}
