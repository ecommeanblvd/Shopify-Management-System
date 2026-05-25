// Pure quote engine. No DB, no I/O. The actions layer loads a snapshot from
// the DB and passes it in. Algorithm follows the spec (2026-05-25-carrier-
// rates-design.md §5).

export type SurchargeKind =
  | 'fuel_percent'
  | 'peak_fixed'
  | 'remote_fixed'
  | 'residential_fixed'
  | 'markup_percent'
  | 'per_kg_fixed';

export interface SurchargeSnap {
  kind: SurchargeKind;
  value: number;
  active: boolean;
  /**
   * Optional per-kg companion. When set, the surcharge applies
   * max(value, valuePerKg × weightKg) instead of just value.
   * Used by FedEx ODA Tier B/C which charge "X per shipment or Y per kg,
   * whichever is higher".
   */
  valuePerKg?: number | null;
  /**
   * Optional tier label. Currently only meaningful for kind='remote_fixed':
   * the surcharge applies only when the matched postcode belongs to the same
   * tier. NULL = catch-all (applies to any remote-postcode match).
   */
  tier?: string | null;
}

export interface WeightTierSnap {
  upperKg: number;
}

export interface ZoneSnap {
  label: string;
  /** Cost per weight tier, keyed by tier.upperKg. */
  rateByTierUpper: Map<number, number>;
}

export interface CarrierAccountSnapshot {
  id: string;
  costCurrency: string;
  displayCurrency: string;
  /** How many cost-currency units equal one display-currency unit. */
  fxCostPerDisplay: number;
  /** ISO-2 country code → zone snapshot. */
  zonesByCountry: Map<string, ZoneSnap>;
  /** Tiers sorted ascending by upperKg. */
  weightTiers: WeightTierSnap[];
  /** Only active surcharges. */
  surcharges: SurchargeSnap[];
  /**
   * ISO-2 country → (postcode pattern → tier or null).
   * Tier is carried alongside each pattern so the engine can pick the
   * right tier-scoped remote_fixed surcharge when a postcode matches.
   */
  remotePostcodes: Map<string, Map<string, string | null>>;
}

export interface QuoteInput {
  weightKg: number;
  destinationCountry: string;
  destinationPostcode?: string;
  isResidential?: boolean;
}

export interface QuoteBreakdown {
  base: number;
  fuel: number;
  peak: number;
  remote: number;
  residential: number;
  perKg: number;
  markup: number;
  subtotalBeforeMarkup: number;
  finalCost: number;
  finalDisplay: number;
}

export interface QuoteOk {
  ok: true;
  zone: string;
  tier: { upperKg: number; index: number };
  breakdown: QuoteBreakdown;
  notes: string[];
}

export type QuoteErrorCode =
  | 'no_zone'
  | 'no_tiers'
  | 'rate_cell_missing'
  | 'invalid_weight'
  | 'invalid_country'
  | 'invalid_fx';

export interface QuoteError {
  ok: false;
  code: QuoteErrorCode;
  message: string;
}

export type QuoteResult = QuoteOk | QuoteError;

const ISO2_RE = /^[A-Z]{2}$/;

function sumActiveOfKind(surcharges: SurchargeSnap[], kind: SurchargeKind): number {
  return surcharges
    .filter((s) => s.active && s.kind === kind)
    .reduce((sum, s) => sum + s.value, 0);
}

/**
 * Tier-aware sum for remote_fixed surcharges. A surcharge applies if it has no
 * tier (catch-all) OR its tier matches the matched postcode's tier exactly.
 * Surcharges that specify a different tier are skipped.
 *
 * When the surcharge has a valuePerKg companion, the contributed amount is
 * max(value, valuePerKg × weightKg) — FedEx ODA Tier B/C semantics.
 */
function sumRemoteFixed(
  surcharges: SurchargeSnap[],
  matchedTier: string | null,
  weightKg: number,
): number {
  return surcharges
    .filter((s) => s.active && s.kind === 'remote_fixed')
    .filter((s) => !s.tier || s.tier === matchedTier)
    .reduce((sum, s) => {
      const perKgAmt = s.valuePerKg && s.valuePerKg > 0 ? s.valuePerKg * weightKg : 0;
      return sum + Math.max(s.value, perKgAmt);
    }, 0);
}

export function quote(snap: CarrierAccountSnapshot, input: QuoteInput): QuoteResult {
  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    return { ok: false, code: 'invalid_weight', message: 'Weight must be a positive number.' };
  }
  const country = input.destinationCountry?.trim().toUpperCase();
  if (!country || !ISO2_RE.test(country)) {
    return { ok: false, code: 'invalid_country', message: 'Country must be an ISO-2 code.' };
  }
  if (!Number.isFinite(snap.fxCostPerDisplay) || snap.fxCostPerDisplay <= 0) {
    return { ok: false, code: 'invalid_fx', message: 'FX rate must be a positive number.' };
  }
  if (snap.weightTiers.length === 0) {
    return { ok: false, code: 'no_tiers', message: 'Account has no weight tiers configured.' };
  }

  const zone = snap.zonesByCountry.get(country);
  if (!zone) {
    return { ok: false, code: 'no_zone', message: `Country ${country} is not assigned to any zone.` };
  }

  const notes: string[] = [];
  // Find first tier whose upperKg ≥ weight. If none, use the last tier and warn.
  let tierIndex = snap.weightTiers.findIndex((t) => t.upperKg >= input.weightKg);
  if (tierIndex === -1) {
    tierIndex = snap.weightTiers.length - 1;
    notes.push(`weight_exceeds_top_tier (${snap.weightTiers[tierIndex].upperKg} kg)`);
  }
  const tier = snap.weightTiers[tierIndex];

  const base = zone.rateByTierUpper.get(tier.upperKg);
  if (base === undefined) {
    return {
      ok: false,
      code: 'rate_cell_missing',
      message: `No rate cell for zone ${zone.label} at tier ${tier.upperKg} kg.`,
    };
  }

  const fuelPct = sumActiveOfKind(snap.surcharges, 'fuel_percent');
  const fuel = base * (fuelPct / 100);

  const peak = sumActiveOfKind(snap.surcharges, 'peak_fixed');

  const perKgUnit = sumActiveOfKind(snap.surcharges, 'per_kg_fixed');
  const perKg = perKgUnit * input.weightKg;

  let remote = 0;
  if (input.destinationPostcode) {
    const patterns = snap.remotePostcodes.get(country);
    const matchedTier = patterns?.get(input.destinationPostcode.trim());
    if (matchedTier !== undefined) {
      // matchedTier may be null (no tier) or a label like 'Tier A'.
      remote = sumRemoteFixed(snap.surcharges, matchedTier, input.weightKg);
      if (matchedTier) notes.push(`remote_match (${matchedTier})`);
      else notes.push('remote_match');
    }
  }

  const residential = input.isResidential
    ? sumActiveOfKind(snap.surcharges, 'residential_fixed')
    : 0;

  const subtotalBeforeMarkup = base + fuel + peak + remote + residential + perKg;
  const markupPct = sumActiveOfKind(snap.surcharges, 'markup_percent');
  const markup = subtotalBeforeMarkup * (markupPct / 100);
  const finalCost = Math.round(subtotalBeforeMarkup + markup);
  const finalDisplay = Math.round((finalCost / snap.fxCostPerDisplay) * 100) / 100;

  return {
    ok: true,
    zone: zone.label,
    tier: { upperKg: tier.upperKg, index: tierIndex },
    breakdown: {
      base: Math.round(base),
      fuel: Math.round(fuel),
      peak: Math.round(peak),
      remote: Math.round(remote),
      residential: Math.round(residential),
      perKg: Math.round(perKg),
      markup: Math.round(markup),
      subtotalBeforeMarkup: Math.round(subtotalBeforeMarkup),
      finalCost,
      finalDisplay,
    },
    notes,
  };
}
