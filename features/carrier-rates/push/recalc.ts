// Pure recalc engine. Given a market + carrier-account snapshots, produce a
// MarketShipping object compatible with market_store_overrides.shipping.
//
// Why splitting matters: Shopify enforces one-country-one-zone per delivery
// profile. If a market contains countries that fall under different zones for
// each linked carrier (e.g. Middle East has DHL 9/10 × FedEx F/H), serving all
// of them under a single Shopify zone would force every rate to a single
// representative — undercharging the more-distant countries and overcharging
// the closer ones.
//
// Strategy:
//   1. Compute a "carrier zone signature" per country: a tuple keyed by
//      carrier (sorted) listing each carrier's zone label for that country
//      (or null when the carrier doesn't serve it).
//   2. Group countries by signature. Each unique signature emits ONE Shopify
//      zone — every country in that zone has the same carrier zones for every
//      linked service, so a single quote-per-tier is exact.
//   3. Within a zone, for each service: if the carrier has a zone for that
//      group, emit `${serviceLabel} (prev–upper kg)` rates. If not, skip that
//      service's rate (per operator preference: include the country, just
//      don't quote the unavailable carrier).
//
// No DB calls. The loader composes everything in load.ts and the commit
// action stages the output into market_store_overrides.

import { quote, type CarrierAccountSnapshot, type QuoteResult } from '../engine/quote';
import type { MarketShipping, ShippingRate, ShippingZone } from '@/features/markets/types';

export interface CarrierServiceForRecalc {
  carrierAccountId: string;
  /** Stable carrier brand key, e.g. 'dhl' or 'fedex'. Used in zone naming. */
  carrierKey: string;
  serviceLabel: string;
  snapshot: CarrierAccountSnapshot;
}

export interface RecalcMarketInput {
  marketHandle: string;
  marketName: string;
  countries: string[];
  primaryCurrency: string;
  services: CarrierServiceForRecalc[];
}

export interface RecalcRateBreakdown {
  /** The Shopify zone this rate sits in (after splitting). */
  zoneName: string;
  /** The countries grouped into that zone. */
  zoneCountries: string[];
  rateName: string;
  prevUpper: number;
  upperKg: number;
  /** Country used to quote (first in group; all share the same carrier zone). */
  representativeCountry: string | null;
  /** Final display-currency amount the customer would see. NaN when no quote. */
  finalDisplay: number;
  /** Cost-currency amount (VND for DHL/FedEx). */
  finalCost: number;
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
  const shipping: MarketShipping = { zones: {} };

  if (input.countries.length === 0 || input.services.length === 0) {
    return { shipping, breakdown };
  }

  // Services sorted by carrierKey so the signature key is deterministic.
  const sortedServices = [...input.services].sort((a, b) => a.carrierKey.localeCompare(b.carrierKey));

  // 1. Group countries by carrier zone signature.
  interface Group {
    countries: string[];
    perCarrierZone: Record<string, string | null>;
  }
  const groups = new Map<string, Group>();

  for (const country of input.countries) {
    const perCarrierZone: Record<string, string | null> = {};
    for (const svc of sortedServices) {
      perCarrierZone[svc.carrierKey] = svc.snapshot.zonesByCountry.get(country)?.label ?? null;
    }
    const sig = sortedServices
      .map((s) => `${s.carrierKey}=${perCarrierZone[s.carrierKey] ?? 'X'}`)
      .join('|');

    let group = groups.get(sig);
    if (!group) {
      group = { countries: [], perCarrierZone };
      groups.set(sig, group);
    }
    group.countries.push(country);
  }

  // 2. For each group, emit a zone with rates.
  for (const group of groups.values()) {
    const zoneName = formatZoneName(input.marketName, sortedServices, group.perCarrierZone);
    const rates: Record<string, ShippingRate> = {};

    for (const svc of sortedServices) {
      const carrierZoneLabel = group.perCarrierZone[svc.carrierKey];
      if (!carrierZoneLabel) {
        // Carrier doesn't serve any country in this group — skip its rates.
        breakdown.push({
          zoneName,
          zoneCountries: group.countries,
          rateName: `${svc.serviceLabel} (carrier unavailable)`,
          prevUpper: 0,
          upperKg: 0,
          representativeCountry: null,
          finalDisplay: Number.NaN,
          finalCost: Number.NaN,
          serviceLabel: svc.serviceLabel,
          carrierAccountId: svc.carrierAccountId,
          warning: 'carrier does not serve any country in this zone',
        });
        continue;
      }

      const tiers = svc.snapshot.weightTiers;
      const representative = group.countries[0];

      for (let i = 0; i < tiers.length; i += 1) {
        const prevUpper = i === 0 ? 0 : tiers[i - 1].upperKg;
        const upper = tiers[i].upperKg;
        const rateName = `${svc.serviceLabel} (${fmtKg(prevUpper)}–${fmtKg(upper)} kg)`;

        // isResidential: true → matrix GIẢ ĐỊNH địa chỉ nhà dân. Phí residential
        // chỉ thực sự cộng cho nước nằm trong residential_fixed.country_codes
        // (FedEx = US/CA). Đa số đơn US/CA là nhà dân (67–85%) nên nung sẵn vào
        // giá thu khách; nước khác không có row → không đổi.
        const q: QuoteResult = quote(svc.snapshot, {
          weightKg: upper,
          destinationCountry: representative,
          isResidential: true,
        });
        if (q.ok) {
          rates[rateName] = {
            type: 'flat',
            price: q.breakdown.finalDisplay,
            currency: input.primaryCurrency,
          };
          breakdown.push({
            zoneName,
            zoneCountries: group.countries,
            rateName,
            prevUpper,
            upperKg: upper,
            representativeCountry: representative,
            finalDisplay: q.breakdown.finalDisplay,
            finalCost: q.breakdown.finalCost,
            serviceLabel: svc.serviceLabel,
            carrierAccountId: svc.carrierAccountId,
            warning: null,
          });
        } else {
          breakdown.push({
            zoneName,
            zoneCountries: group.countries,
            rateName,
            prevUpper,
            upperKg: upper,
            representativeCountry: representative,
            finalDisplay: Number.NaN,
            finalCost: Number.NaN,
            serviceLabel: svc.serviceLabel,
            carrierAccountId: svc.carrierAccountId,
            warning: q.code,
          });
        }
      }
    }

    const zone: ShippingZone = {
      countries: group.countries,
      rates,
    };
    shipping.zones[zoneName] = zone;
  }

  return { shipping, breakdown };
}

/**
 * Auto-generated Shopify zone name. Examples:
 *   "Middle East — DHL 9 / FedEx H"
 *   "Middle East — DHL 10 / FedEx F"
 *   "South East Asia — DHL 1 / FedEx Q"  (when group has only MY)
 *   "Europe — DHL 8" (when only DHL is linked)
 *   "Europe — DHL 8 / FedEx —" (when FedEx doesn't serve the group)
 */
function formatZoneName(
  marketName: string,
  services: CarrierServiceForRecalc[],
  perCarrierZone: Record<string, string | null>,
): string {
  const parts = services.map((s) => {
    const zoneLabel = perCarrierZone[s.carrierKey];
    const carrierDisplay = formatCarrierKey(s.carrierKey);
    return `${carrierDisplay} ${zoneLabel ? stripZonePrefix(zoneLabel) : '—'}`;
  });
  return `${marketName} — ${parts.join(' / ')}`;
}

function formatCarrierKey(key: string): string {
  if (key === 'dhl') return 'DHL';
  if (key === 'fedex') return 'FedEx';
  if (key === 'ups') return 'UPS';
  // Fallback: capitalize.
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** "Zone 1" → "1", "Zone A" → "A". Leaves anything else alone. */
function stripZonePrefix(label: string): string {
  return label.replace(/^zone\s+/i, '');
}

function fmtKg(kg: number): string {
  return Number.isInteger(kg) ? kg.toString() : kg.toString();
}
