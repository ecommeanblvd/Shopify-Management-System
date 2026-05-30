/**
 * Live shipping-cost estimate via the existing carrier-rates engine.
 *
 * Strategy:
 *   1. Find every market whose `countries` JSONB array contains the order's
 *      ship-to country.
 *   2. Find every enabled `market_carrier_links` for those markets.
 *   3. For each carrier account, load a snapshot and run `quote()`.
 *   4. Return the *minimum* finalDisplay across successful quotes — the
 *      operator typically picks the cheapest carrier per shipment.
 *
 * Returns `source: 'engine_estimate'` when at least one carrier produces a
 * quote, and `source: 'unknown'` when no carrier covers the destination or
 * the destination/weight are missing.
 *
 * The carrier-engine's `finalDisplay` is in the carrier account's
 * `displayCurrency` (typically the store's primary currency). v1 ships
 * without cross-currency conversion; v2 can add an FX lookup if MEAN/CICI
 * ever quote against orders in a different currency than the carrier's
 * displayCurrency.
 */

import { sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';

export interface EngineEstimateInput {
  shipCountry: string | null;
  shipWeightKg: number | null;
}

export interface EngineEstimateResult {
  amount: number;
  source: 'engine_estimate' | 'unknown';
}

export async function resolveShippingEstimate(
  input: EngineEstimateInput,
): Promise<EngineEstimateResult> {
  if (!input.shipCountry || !input.shipWeightKg || input.shipWeightKg <= 0) {
    return { amount: 0, source: 'unknown' };
  }

  // 1. Markets containing this country. `countries` is jsonb of ISO-2 strings.
  const marketRows = await db.execute<{ handle: string }>(sql`
    SELECT handle FROM market_templates
     WHERE countries @> ${JSON.stringify([input.shipCountry])}::jsonb
       AND enabled = TRUE
  `);
  const markets = marketRows as unknown as Array<{ handle: string }>;
  if (markets.length === 0) return { amount: 0, source: 'unknown' };

  // 2. Carrier accounts linked to any of those markets (enabled links only).
  const handles = markets.map((m) => m.handle);
  const links = await db
    .select({ carrierAccountId: schema.marketCarrierLinks.carrierAccountId })
    .from(schema.marketCarrierLinks)
    .where(
      // Filter by market handle and enabled
      sql`${schema.marketCarrierLinks.marketHandle} = ANY(${handles}) AND ${schema.marketCarrierLinks.enabled} = TRUE`,
    );
  const carrierIds = Array.from(new Set(links.map((l) => l.carrierAccountId)));
  if (carrierIds.length === 0) return { amount: 0, source: 'unknown' };

  // 3. Quote each carrier; pick the cheapest successful display amount.
  let best: number | null = null;
  for (const id of carrierIds) {
    const snap = await loadAccountSnapshot(id);
    if (!snap) continue;
    const q = quote(snap, {
      weightKg: input.shipWeightKg,
      destinationCountry: input.shipCountry,
    });
    if (q.ok) {
      const amt = q.breakdown.finalDisplay;
      if (best === null || amt < best) best = amt;
    }
  }
  if (best === null) return { amount: 0, source: 'unknown' };
  return { amount: best, source: 'engine_estimate' };
}
