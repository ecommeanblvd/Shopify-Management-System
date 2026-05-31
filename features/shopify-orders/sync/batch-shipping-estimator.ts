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

export interface EngineEstimateInput {
  shipCountry: string | null;
  shipWeightKg: number | null;
}

/**
 * Why an order's shipping cost couldn't be priced by the carrier engine.
 * Surfaced in the dashboard so the operator can see the root cause and
 * fix it at the source (set variant weights, add a market, link a
 * carrier, etc.) instead of guessing.
 */
export type EngineEstimateReason =
  | 'no_country'        // order has no shipping country (pickup, digital, etc.)
  | 'no_weight'         // order has no chargeable weight on its line items
  | 'no_market'         // no enabled market_template covers this country
  | 'no_carrier_link'   // markets exist for the country but no enabled carrier link
  | 'no_quote';         // carriers exist but none could produce a tier-+zone-matched quote

export interface EngineEstimateResult {
  amount: number;
  source: 'engine_estimate' | 'unknown';
  /** Present only when `source === 'unknown'`. */
  reason?: EngineEstimateReason;
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

  // 3. Snapshots for every distinct carrier ever reached by an enabled
  // link. Parallel so the total wait is one snapshot, not N.
  const allCarrierIds = Array.from(new Set(links.map((l) => l.carrierAccountId)));
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

  return {
    estimate(input: EngineEstimateInput): EngineEstimateResult {
      // Country and weight come from `shipping_address.country_code_v2`
      // and `total_weight` on the Shopify order respectively. Either
      // missing means the order can't even start a quote — surface why.
      if (!input.shipCountry) return { amount: 0, source: 'unknown', reason: 'no_country' };
      if (!input.shipWeightKg || input.shipWeightKg <= 0) {
        return { amount: 0, source: 'unknown', reason: 'no_weight' };
      }
      // Round weight to 3 dp so micro-fluctuations don't bust the memo;
      // the rate matrix only changes on tier boundaries anyway.
      const wKey = Math.round(input.shipWeightKg * 1000) / 1000;
      const key = `${input.shipCountry}|${wKey}`;
      const cached = memo.get(key);
      if (cached) return cached;

      const marketHandles = marketsByCountry.get(input.shipCountry) ?? [];
      if (marketHandles.length === 0) {
        const r: EngineEstimateResult = { amount: 0, source: 'unknown', reason: 'no_market' };
        memo.set(key, r);
        return r;
      }
      const carrierIds = carriersFor(input.shipCountry);
      if (carrierIds.length === 0) {
        const r: EngineEstimateResult = { amount: 0, source: 'unknown', reason: 'no_carrier_link' };
        memo.set(key, r);
        return r;
      }

      let best: number | null = null;
      for (const id of carrierIds) {
        const snap = snapshotsByCarrier.get(id);
        if (!snap) continue;
        const q = quote(snap, {
          weightKg: input.shipWeightKg,
          destinationCountry: input.shipCountry,
        });
        if (q.ok) {
          const amt = q.breakdown.carrierCostDisplay;
          if (best === null || amt < best) best = amt;
        }
      }

      // Carriers exist for this country but none could produce a quote
      // — usually means the country isn't in any zone, or the weight
      // overflows the last tier.
      const result: EngineEstimateResult = best === null
        ? { amount: 0, source: 'unknown', reason: 'no_quote' }
        : { amount: best, source: 'engine_estimate' };
      memo.set(key, result);
      return result;
    },
  };
}
