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
  /** ISO-2 country → set of remote postcode patterns. */
  remotePostcodes: Map<string, Set<string>>;
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
    if (patterns && patterns.has(input.destinationPostcode.trim())) {
      remote = sumActiveOfKind(snap.surcharges, 'remote_fixed');
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
