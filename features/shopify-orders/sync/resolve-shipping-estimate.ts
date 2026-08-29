/**
 * Live shipping-cost estimate via the existing carrier-rates engine.
 * Single-order variant used by the order-edit modal — for the dashboard's
 * many-orders path, see `batch-shipping-estimator.ts`.
 *
 * Strategy (per operator spec, 2026-06-03):
 *   - Quote against the carrier the customer actually paid Shopify shipping
 *     for (`shopify_orders.shipping_carrier_key`, parsed from the order's
 *     shipping lines).
 *   - When the order has no detectable shipping line (Shopify dropped it,
 *     free fulfilment, manual pickup, etc.) default to FedEx and emit
 *     `fallback: true` so the UI can flag implicit attribution.
 *   - NEVER auto-pick the cheapest carrier — that mis-attributes cost
 *     when the actual ship-line was the more expensive one.
 *
 * The carrier-engine's `carrierCostDisplay` is in the carrier account's
 * `displayCurrency` (typically the store's primary currency). v1 ships
 * without cross-currency conversion; v2 can add an FX lookup if MEAN/CICI
 * ever quote against orders in a different currency than the carrier's
 * displayCurrency.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { quote, type QuoteBreakdown } from '@/features/carrier-rates/engine/quote';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import type { EngineEstimateReason } from './batch-shipping-estimator';

export interface EngineEstimateInput {
  shipCountry: string | null;
  shipWeightKg: number | null;
  /** Shopify `shippingAddress.zip`. Drives the engine's remote-area
   *  lookup for carriers that publish remote postcodes (FedEx IL,
   *  DHL most non-ME). Null → falls back to city, then to "not remote". */
  shipPostcode?: string | null;
  /** Shopify `shippingAddress.city`. Drives the same lookup when the
   *  remote-area list is by city (FedEx ME, DHL ME). Normalised
   *  upstream — see engine quote.ts for the matching rule. */
  shipCity?: string | null;
  /**
   * Effective quote date — defaults to "now". Pass the order's
   * `processed_at_shopify` to reproduce the carrier's historical rate
   * sheet (the fuel surcharge changes every week). Without this, an
   * order from 29/04 would be priced against today's fuel %.
   */
  effectiveDate?: Date;
  /**
   * Carrier key pinned per order. Resolves to the carrier the customer
   * actually paid Shopify shipping for (parsed from `shippingLines`).
   * NULL or unknown → defaults to 'fedex' per operator spec: never
   * auto-pick the cheapest because that mis-attributes costs when DHL
   * was the real carrier.
   */
  shippingCarrierKey?: string | null;
}

/** What the engine falls back to when no shipping line was detected on the
 *  order (Shopify dropped it, free fulfilment, pickup, etc.). The operator
 *  has confirmed every store routes to FedEx by default. */
const DEFAULT_CARRIER_KEY = 'fedex';

export interface EngineEstimateResult {
  /** Carrier cost in display currency (USD), derived via FX. */
  amount: number;
  /** Carrier cost in cost currency (VND), straight from the rate sheet. */
  costAmount: number;
  /** ISO-3 of `costAmount`. */
  costCurrency: string;
  /** Engine line-item breakdown (base, surcharges, fuel, VAT, …) in the
   *  COST currency, present only when source === 'engine_estimate'. The
   *  order-edit modal uses this to render the cost breakdown table. */
  breakdown: QuoteBreakdown | null;
  /** Carrier name (e.g. 'FedEx Vietnam 2026') of the cheapest quoting
   *  carrier — labels the breakdown so operator knows which rate sheet
   *  produced the numbers. */
  carrierLabel: string | null;
  /** Resolved carrier key ('fedex' | 'dhl') the quote ran against. */
  carrierKey: string | null;
  /** Matched zone label + weight tier upper bound, for context. */
  zone: string | null;
  tierUpperKg: number | null;
  source: 'engine_estimate' | 'unknown';
  /** Present only when `source === 'unknown'`. Matches the taxonomy
   *  used by the batched dashboard estimator. */
  reason?: EngineEstimateReason;
  /** True when the engine fell back from configured `market_carrier_links`
   *  to "any enabled carrier whose zones cover this country". */
  fallback?: boolean;
}

function emptyResult(reason: EngineEstimateReason): EngineEstimateResult {
  return {
    amount: 0, costAmount: 0, costCurrency: '',
    breakdown: null, carrierLabel: null, carrierKey: null, zone: null, tierUpperKg: null,
    source: 'unknown', reason,
  };
}

export async function resolveShippingEstimate(
  input: EngineEstimateInput,
): Promise<EngineEstimateResult> {
  if (!input.shipCountry) return emptyResult('no_country');
  if (!input.shipWeightKg || input.shipWeightKg <= 0) return emptyResult('no_weight');

  // Carrier is pinned per order — quote against the carrier the
  // customer actually paid Shopify shipping for. NULL / unknown
  // shipping line resolves to FedEx per operator spec.
  const carrierKey = input.shippingCarrierKey?.trim().toLowerCase() || DEFAULT_CARRIER_KEY;

  const accountRows = await db
    .select({ id: schema.carrierAccounts.id })
    .from(schema.carrierAccounts)
    .leftJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(
      and(
        eq(schema.carriers.key, carrierKey),
        eq(schema.carrierAccounts.enabled, true),
      ),
    );
  if (accountRows.length === 0) return emptyResult('no_carrier_accounts');

  const best = await tryCarriers(
    accountRows.map((r) => r.id),
    input.shipCountry,
    input.shipWeightKg,
    input.shipPostcode ?? null,
    input.shipCity ?? null,
    input.effectiveDate,
  );
  if (best === null) return emptyResult('no_quote');
  return {
    amount: best.display,
    costAmount: best.cost,
    costCurrency: best.costCurrency,
    breakdown: best.breakdown,
    carrierLabel: best.carrierLabel,
    carrierKey,
    zone: best.zone,
    tierUpperKg: best.tierUpperKg,
    source: 'engine_estimate',
    // True when the order didn't carry a shipping line and we fell
    // back to the DEFAULT_CARRIER_KEY — UI surfaces this so the
    // operator sees implicit attribution.
    fallback: input.shippingCarrierKey ? false : true,
  };
}

interface CarrierAttempt {
  display: number;
  cost: number;
  costCurrency: string;
  breakdown: QuoteBreakdown;
  carrierLabel: string;
  zone: string;
  tierUpperKg: number;
}

/**
 * Cheapest carrier-cost quote across the given carriers — pre-markup, in
 * BOTH the display currency (USD) and the carrier's cost currency (VND),
 * so the dashboard can render either without an FX round-trip. Also
 * returns the full engine breakdown so the order-edit modal can render
 * the line-item table (base, surcharges, fuel, VAT, …).
 */
async function tryCarriers(
  carrierIds: readonly string[],
  country: string,
  weightKg: number,
  postcode: string | null,
  city: string | null,
  effectiveDate?: Date,
): Promise<CarrierAttempt | null> {
  let best: CarrierAttempt | null = null;
  for (const id of carrierIds) {
    const snap = await loadAccountSnapshot(id, effectiveDate ?? new Date(), {
      remoteCountry: country,
      remotePostcodes: [postcode],
    });
    if (!snap) continue;
    const q = quote(snap, {
      weightKg,
      destinationCountry: country,
      destinationPostcode: postcode ?? undefined,
      destinationCity: city ?? undefined,
      effectiveDate,
      // KHÔNG bật: ký nhận FedEx/DHL đã là apply_mode='always' nên engine tự
      // cộng. Cờ này giờ chỉ mở phụ phí THEO-CA (UPS sai địa chỉ, pallet Aramex).
      signatureOptIn: false,
    });
    if (q.ok) {
      const display = q.breakdown.carrierCostDisplay;
      if (best === null || display < best.display) {
        best = {
          display,
          cost: q.breakdown.carrierCost,
          costCurrency: snap.costCurrency,
          breakdown: q.breakdown,
          carrierLabel: snap.name,
          zone: q.zone,
          tierUpperKg: q.tier.upperKg,
        };
      }
    }
  }
  return best;
}
