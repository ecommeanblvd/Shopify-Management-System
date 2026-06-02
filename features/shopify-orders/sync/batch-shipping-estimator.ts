/**
 * Batched alternative to `resolveShippingEstimate` for the orders
 * dashboard, which calls it once per order. The naïve per-order path
 * runs 2 SQL queries plus one full carrier-account snapshot load per
 * order, which itself is 5 parallel queries — so a single 90-day load
 * for a busy store can fan out into thousands of DB roundtrips.
 *
 * Strategy: do all the setup queries ONCE at the top:
 *
 *   - every enabled market_template + its `countries` array
 *   - every enabled market_carrier_link row
 *   - one `loadAccountSnapshot` per carrier-account that any enabled
 *     link points at
 *
 * Then `estimate({ shipCountry, shipWeightKg })` is pure CPU work
 * over the in-memory caches plus a tiny `(country, weight)` memo so
 * orders that ship to the same country at the same weight pay
 * exactly once.
 *
 * Result envelope matches `resolveShippingEstimate` so the call sites
 * remain interchangeable.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type CarrierAccountSnapshot } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

const DAY_MS = 86_400_000;

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
  shipWeightKg: number | null;
  /**
   * Effective quote date — defaults to "now". Pass the order's
   * `processed_at_shopify` so fuel-surcharge time-versioning resolves
   * to the rate sheet from the order's ship week.
   */
  effectiveDate?: Date;
}

/**
 * Why an order's shipping cost couldn't be priced by the carrier engine.
 * Surfaced in the dashboard so the operator can see the root cause and
 * fix it at the source (set variant weights, add a market, link a
 * carrier, etc.) instead of guessing.
 */
export type EngineEstimateReason =
  | 'no_country'           // order has no shipping country (pickup, digital, etc.)
  | 'no_weight'            // order has no chargeable weight on its line items
  | 'no_carrier_accounts'  // there are no enabled carrier accounts in the system at all
  | 'no_quote';            // carriers exist but none could produce a tier-+zone-matched quote
//
// NOTE: `no_market` and `no_carrier_link` are deliberately retired now that
// the estimator falls back to ANY enabled carrier whose zones cover the
// country — the operator told us their carriers are all FedEx and they want
// orders priced even when the market-link table is incomplete. The shape is
// kept (legacy DB rows / strings may still contain these values) and the UI
// keeps friendly labels for them, but the estimator no longer emits them.

export interface EngineEstimateResult {
  /** Carrier cost in the carrier's DISPLAY currency (typically the order
   *  currency, e.g. USD). Derived via `carrierCost / fxCostPerDisplay`. */
  amount: number;
  /** Carrier cost in the carrier's COST currency (e.g. VND). This is the
   *  raw integer from the rate sheet + surcharges — no FX round-trip. The
   *  dashboard uses it for cost-currency display so the operator sees the
   *  same VND number the engine actually computed (and that the carrier
   *  will invoice), not a re-derived value. */
  costAmount: number;
  /** ISO-3 code of `costAmount`'s currency. */
  costCurrency: string;
  source: 'engine_estimate' | 'unknown';
  /** Present only when `source === 'unknown'`. */
  reason?: EngineEstimateReason;
  /** True when the engine had to fall back from the configured
   *  market_carrier_links to "any enabled carrier whose zones cover this
   *  country". Useful for the dashboard to flag implicit FedEx pricing
   *  vs. operator-intentional carrier choice. */
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
  // 1. Every enabled market and its country list.
  const marketRows = await db
    .select({
      handle: schema.marketTemplates.handle,
      countries: schema.marketTemplates.countries,
    })
    .from(schema.marketTemplates)
    .where(eq(schema.marketTemplates.enabled, true));

  // Country → market handles
  const marketsByCountry = new Map<string, string[]>();
  for (const m of marketRows) {
    const countries = (m.countries as unknown as string[] | null) ?? [];
    for (const c of countries) {
      const arr = marketsByCountry.get(c) ?? [];
      arr.push(m.handle);
      marketsByCountry.set(c, arr);
    }
  }

  // 2. Every enabled carrier link.
  const links = await db
    .select({
      marketHandle: schema.marketCarrierLinks.marketHandle,
      carrierAccountId: schema.marketCarrierLinks.carrierAccountId,
    })
    .from(schema.marketCarrierLinks)
    .where(eq(schema.marketCarrierLinks.enabled, true));

  // Market → carrier ids
  const carriersByMarket = new Map<string, string[]>();
  for (const l of links) {
    const arr = carriersByMarket.get(l.marketHandle) ?? [];
    arr.push(l.carrierAccountId);
    carriersByMarket.set(l.marketHandle, arr);
  }

  // 3. Every enabled carrier account in the system — superset of the
  // ones reached by `market_carrier_links`. The operator told us their
  // carriers are all FedEx, so we load every active account and use it
  // as the fallback when an order's market has no explicit link. The
  // operator-intentional path (linked carriers) is tried first; the
  // fallback engages only when the primary path returns nothing.
  const allAccountRows = await db
    .select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.enabled, true));
  const allCarrierIds = allAccountRows.map((r) => r.id);

  // Parallel so the total wait is one snapshot, not N.
  const snapshotEntries = await Promise.all(
    allCarrierIds.map(async (id): Promise<[string, CarrierAccountSnapshot | null]> => {
      return [id, await loadAccountSnapshot(id)];
    }),
  );
  const snapshotsByCarrier = new Map<string, CarrierAccountSnapshot>();
  for (const [id, snap] of snapshotEntries) {
    if (snap) snapshotsByCarrier.set(id, snap);
  }

  // 4. Per-(country, weight) memo. Many orders in a window share a
  // small handful of (country, weightKg) pairs once weight is rounded.
  const memo = new Map<string, EngineEstimateResult>();

  function carriersFor(country: string): string[] {
    const handles = marketsByCountry.get(country) ?? [];
    if (handles.length === 0) return [];
    const set = new Set<string>();
    for (const h of handles) {
      for (const c of carriersByMarket.get(h) ?? []) set.add(c);
    }
    return [...set];
  }

  /**
   * Cheapest successful quote across the given carrier ids, or null if
   * none of them can quote the country+weight. Returns both the
   * display-currency value (USD) and the underlying cost-currency value
   * (VND) so the dashboard can render the original VND directly without
   * a USD→VND round-trip that loses 2dp precision.
   */
  function bestQuote(
    carrierIds: readonly string[], country: string, weightKg: number, effectiveDate?: Date,
  ): { display: number; cost: number; costCurrency: string } | null {
    let best: { display: number; cost: number; costCurrency: string } | null = null;
    for (const id of carrierIds) {
      const snap = snapshotsByCarrier.get(id);
      if (!snap) continue;
      const q = quote(snap, { weightKg, destinationCountry: country, effectiveDate });
      if (q.ok) {
        const display = q.breakdown.carrierCostDisplay;
        if (best === null || display < best.display) {
          best = {
            display,
            cost: q.breakdown.carrierCost,
            costCurrency: snap.costCurrency,
          };
        }
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
      // Round weight to 3 dp so micro-fluctuations don't bust the memo;
      // the rate matrix only changes on tier boundaries anyway. The
      // effectiveDate bucket is the order's UTC week (Mon midnight) so
      // many orders shipped the same week share one memo entry — fuel %
      // only changes weekly, so finer granularity doesn't pay off.
      const wKey = Math.round(input.shipWeightKg * 1000) / 1000;
      const dKey = input.effectiveDate
        ? mondayUtcMs(input.effectiveDate)
        : 'now';
      const key = `${input.shipCountry}|${wKey}|${dKey}`;
      const cached = memo.get(key);
      if (cached) return cached;

      // System has no enabled carrier accounts at all. There's nothing
      // to fall back to — the operator needs to configure a carrier
      // before any order can be priced.
      if (allCarrierIds.length === 0) {
        const r: EngineEstimateResult = {
          amount: 0, costAmount: 0, costCurrency: '',
          source: 'unknown', reason: 'no_carrier_accounts',
        };
        memo.set(key, r);
        return r;
      }

      // Primary path: carriers explicitly linked to a market that
      // covers this country. Cheapest of those wins.
      const linkedCarrierIds = carriersFor(input.shipCountry);
      const linkedBest = bestQuote(linkedCarrierIds, input.shipCountry, input.shipWeightKg, input.effectiveDate);
      if (linkedBest !== null) {
        const r: EngineEstimateResult = {
          amount: linkedBest.display,
          costAmount: linkedBest.cost,
          costCurrency: linkedBest.costCurrency,
          source: 'engine_estimate',
        };
        memo.set(key, r);
        return r;
      }

      // Fallback path: every other enabled carrier the operator has on
      // file. The operator pre-confirmed that their carriers are all
      // FedEx rate sheets (manual import), so silently picking any of
      // them keeps orders priced without requiring an exhaustive
      // market_carrier_links setup. Surface `fallback: true` so the UI
      // can flag implicit FedEx pricing.
      const fallbackCarrierIds = allCarrierIds.filter((id) => !linkedCarrierIds.includes(id));
      const fallbackBest = bestQuote(fallbackCarrierIds, input.shipCountry, input.shipWeightKg, input.effectiveDate);
      if (fallbackBest !== null) {
        const r: EngineEstimateResult = {
          amount: fallbackBest.display,
          costAmount: fallbackBest.cost,
          costCurrency: fallbackBest.costCurrency,
          source: 'engine_estimate',
          fallback: true,
        };
        memo.set(key, r);
        return r;
      }

      // No carrier could quote this destination/weight at all. Usually
      // means the country isn't in ANY zone, or the weight overflows
      // every carrier's last tier.
      const r: EngineEstimateResult = {
        amount: 0, costAmount: 0, costCurrency: '',
        source: 'unknown', reason: 'no_quote',
      };
      memo.set(key, r);
      return r;
    },
  };
}
