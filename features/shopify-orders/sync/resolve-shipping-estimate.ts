/**
 * Live shipping-cost estimate via the existing carrier-rates engine.
 * Single-order variant used by the order-edit modal — for the dashboard's
 * many-orders path, see `batch-shipping-estimator.ts`.
 *
 * Strategy:
 *   1. Find every market whose `countries` JSONB array contains the order's
 *      ship-to country, then the carrier accounts linked to those markets.
 *      Cheapest successful quote across those carriers wins (the "primary"
 *      path — explicit operator intent).
 *   2. If nothing's linked, fall back to ANY enabled carrier account whose
 *      zones cover the country. The operator has confirmed all their
 *      carrier accounts are FedEx rate sheets, so this lets orders price
 *      against existing rates even when `market_carrier_links` isn't yet
 *      populated for every country. Emits `fallback: true` so the UI can
 *      flag implicit-FedEx pricing.
 *   3. If nothing on the fallback either, return `unknown` with the most
 *      specific reason the diagnostic can surface.
 *
 * The carrier-engine's `carrierCostDisplay` is in the carrier account's
 * `displayCurrency` (typically the store's primary currency). v1 ships
 * without cross-currency conversion; v2 can add an FX lookup if MEAN/CICI
 * ever quote against orders in a different currency than the carrier's
 * displayCurrency.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import type { EngineEstimateReason } from './batch-shipping-estimator';

export interface EngineEstimateInput {
  shipCountry: string | null;
  shipWeightKg: number | null;
}

export interface EngineEstimateResult {
  amount: number;
  source: 'engine_estimate' | 'unknown';
  /** Present only when `source === 'unknown'`. Matches the taxonomy
   *  used by the batched dashboard estimator. */
  reason?: EngineEstimateReason;
  /** True when the engine fell back from configured `market_carrier_links`
   *  to "any enabled carrier whose zones cover this country". */
  fallback?: boolean;
}

export async function resolveShippingEstimate(
  input: EngineEstimateInput,
): Promise<EngineEstimateResult> {
  if (!input.shipCountry) return { amount: 0, source: 'unknown', reason: 'no_country' };
  if (!input.shipWeightKg || input.shipWeightKg <= 0) {
    return { amount: 0, source: 'unknown', reason: 'no_weight' };
  }

  // Carriers explicitly linked to a market covering this country (the
  // "intentional" path). `db.execute` on drizzle/node-postgres returns
  // a pg QueryResult — rows live under `.rows`, NOT on the top object.
  const marketRows = await db.execute<{ handle: string }>(sql`
    SELECT handle FROM market_templates
     WHERE countries @> ${JSON.stringify([input.shipCountry])}::jsonb
       AND enabled = TRUE
  `);
  const handles = marketRows.rows.map((m) => m.handle);
  const linkedCarrierIds: string[] = handles.length === 0
    ? []
    : Array.from(new Set(
        (await db
          .select({ carrierAccountId: schema.marketCarrierLinks.carrierAccountId })
          .from(schema.marketCarrierLinks)
          .where(
            and(
              inArray(schema.marketCarrierLinks.marketHandle, handles),
              eq(schema.marketCarrierLinks.enabled, true),
            ),
          ))
          .map((l) => l.carrierAccountId),
      ));

  if (linkedCarrierIds.length > 0) {
    const best = await tryCarriers(linkedCarrierIds, input.shipCountry, input.shipWeightKg);
    if (best !== null) return { amount: best, source: 'engine_estimate' };
  }

  // Fall back to every enabled carrier account in the system. The
  // operator told us their carriers are all FedEx rate sheets, so this
  // is a deliberate silent default. The result carries `fallback: true`
  // so the UI can flag implicit pricing if it wants to.
  const allAccountRows = await db
    .select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .where(eq(schema.carrierAccounts.enabled, true));
  if (allAccountRows.length === 0) {
    return { amount: 0, source: 'unknown', reason: 'no_carrier_accounts' };
  }
  const fallbackCarrierIds = allAccountRows
    .map((r) => r.id)
    .filter((id) => !linkedCarrierIds.includes(id));
  const fallbackBest = await tryCarriers(fallbackCarrierIds, input.shipCountry, input.shipWeightKg);
  if (fallbackBest !== null) {
    return { amount: fallbackBest, source: 'engine_estimate', fallback: true };
  }

  return { amount: 0, source: 'unknown', reason: 'no_quote' };
}

/**
 * Cheapest carrier-cost quote (pre-markup, in display currency) across
 * the given carriers, or null if none can cover the destination + weight.
 */
async function tryCarriers(
  carrierIds: readonly string[], country: string, weightKg: number,
): Promise<number | null> {
  let best: number | null = null;
  for (const id of carrierIds) {
    const snap = await loadAccountSnapshot(id);
    if (!snap) continue;
    const q = quote(snap, { weightKg, destinationCountry: country });
    if (q.ok) {
      const amt = q.breakdown.carrierCostDisplay;
      if (best === null || amt < best) best = amt;
    }
  }
  return best;
}
