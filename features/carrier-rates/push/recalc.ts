// Pure recalc engine. Given a market + carrier-account snapshots, produce a
// MarketShipping object compatible with market_store_overrides.shipping.
//
// Strategy:
//   - One shipping zone per market.handle (matches the existing per-store
//     override convention from features/markets).
//   - One Shopify-style rate per (carrier service × weight tier).
//     Rate name format: "${serviceLabel} (prev–upper kg)"
//   - For each tier, quote against a "representative country" from the
//     market's countries (the one that yields the lowest cost for that
//     tier). If the market has no countries, falls back to the carrier's
//     first zoned country in the market list — and skips with a note if
//     none match.
//
// No DB calls here. The loader composes everything in load.ts and the
// commit action stages the output into market_store_overrides.

import { quote, type CarrierAccountSnapshot, type QuoteResult } from '../engine/quote';
import type { MarketShipping, ShippingRate, ShippingZone } from '@/features/markets/types';

export interface CarrierServiceForRecalc {
  carrierAccountId: string;
  serviceLabel: string;
  snapshot: CarrierAccountSnapshot;
}

export interface RecalcMarketInput {
  marketHandle: string;
  countries: string[];
  primaryCurrency: string;
  services: CarrierServiceForRecalc[];
}

export interface RecalcRateBreakdown {
  rateName: string;
  prevUpper: number;
  upperKg: number;
  /** Country used to quote (lowest-priced eligible). */
  representativeCountry: string | null;
  /** Final display-currency amount the customer would see. NaN when no quote. */
  finalDisplay: number;
  /** Cost-currency amount (VND for DHL/FedEx). */
  finalCost: number;
  /** The service label (for grouping in previews). */
  serviceLabel: string;
  carrierAccountId: string;
  /** Empty when the quote succeeded, populated when we skipped. */
  warning: string | null;
}

export interface RecalcResult {
  shipping: MarketShipping;
  breakdown: RecalcRateBreakdown[];
}

/**
 * Build a Shopify-ready MarketShipping object plus a per-rate breakdown.
 * Pure function — no DB calls, no async work.
 */
export function recalcMarket(input: RecalcMarketInput): RecalcResult {
  const breakdown: RecalcRateBreakdown[] = [];
  const rates: Record<string, ShippingRate> = {};

  for (const svc of input.services) {
    const tiers = svc.snapshot.weightTiers;
    for (let i = 0; i < tiers.length; i += 1) {
      const prevUpper = i === 0 ? 0 : tiers[i - 1].upperKg;
      const upper = tiers[i].upperKg;
      const rateName = formatRateName(svc.serviceLabel, prevUpper, upper);

      const best = bestQuoteForCountries(svc.snapshot, upper, input.countries);

      if (best.ok) {
        rates[rateName] = {
          type: 'flat',
          price: best.finalDisplay,
          currency: input.primaryCurrency,
        };
        breakdown.push({
          rateName,
          prevUpper,
          upperKg: upper,
          representativeCountry: best.country,
          finalDisplay: best.finalDisplay,
          finalCost: best.finalCost,
          serviceLabel: svc.serviceLabel,
          carrierAccountId: svc.carrierAccountId,
          warning: null,
        });
      } else {
        breakdown.push({
          rateName,
          prevUpper,
          upperKg: upper,
          representativeCountry: null,
          finalDisplay: Number.NaN,
          finalCost: Number.NaN,
          serviceLabel: svc.serviceLabel,
          carrierAccountId: svc.carrierAccountId,
          warning: best.warning,
        });
      }
    }
  }

  const zone: ShippingZone = {
    countries: input.countries.slice(),
    rates,
  };
  const shipping: MarketShipping = {
    zones: { [input.marketHandle]: zone },
  };
  return { shipping, breakdown };
}

function formatRateName(label: string, prev: number, upper: number): string {
  const lo = fmtKg(prev);
  const hi = fmtKg(upper);
  return `${label} (${lo}–${hi} kg)`;
}

function fmtKg(kg: number): string {
  return Number.isInteger(kg) ? kg.toString() : kg.toString();
}

type BestQuote =
  | { ok: true; country: string; finalDisplay: number; finalCost: number }
  | { ok: false; warning: string };

/**
 * For a given weight tier, run the engine across every country in the market
 * and return the cheapest successful quote. The country picked is the
 * "representative" for that rate row.
 */
function bestQuoteForCountries(
  snap: CarrierAccountSnapshot,
  weightKg: number,
  countries: string[],
): BestQuote {
  if (countries.length === 0) {
    return { ok: false, warning: 'market has no countries' };
  }

  let cheapest: { country: string; finalDisplay: number; finalCost: number } | null = null;
  let firstError: string | null = null;

  for (const c of countries) {
    const r: QuoteResult = quote(snap, { weightKg, destinationCountry: c });
    if (!r.ok) {
      if (!firstError) firstError = `${c}: ${r.code}`;
      continue;
    }
    if (!cheapest || r.breakdown.finalDisplay < cheapest.finalDisplay) {
      cheapest = {
        country: c,
        finalDisplay: r.breakdown.finalDisplay,
        finalCost: r.breakdown.finalCost,
      };
    }
  }

  if (cheapest) return { ok: true, ...cheapest };
  return { ok: false, warning: firstError ?? 'no zoned country in market' };
}
