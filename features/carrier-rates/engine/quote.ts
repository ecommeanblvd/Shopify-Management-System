// Pure quote engine. No DB, no I/O. The actions layer loads a snapshot from
// the DB and passes it in. Algorithm follows the spec (2026-05-25-carrier-
// rates-design.md §5).

export type SurchargeKind =
  | 'fuel_percent'
  | 'peak_fixed'
  | 'remote_fixed'
  | 'residential_fixed'
  | 'markup_percent'
  | 'per_kg_fixed'
  | 'demand_per_kg'
  | 'country_fixed'
  | 'vat_percent';

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
  /**
   * ISO-2 country codes the surcharge applies to. Only meaningful for
   * `demand_per_kg`. NULL = applies to every destination.
   */
  countryCodes?: string[] | null;
}

export interface WeightTierSnap {
  upperKg: number;
}

export interface ZoneSnap {
  label: string;
  /** Package-type rates per weight tier, keyed by tier.upperKg. The
   *  "Package" (box) cells — historical default and the only set
   *  populated before migration 0017. */
  rateByTierUpper: Map<number, number>;
  /** "Pak" (envelope / bag) rates per weight tier. Sparse — only
   *  populated for the low tiers FedEx publishes Pak rates for
   *  (typically ≤ 2.5 kg). Engine falls back to `rateByTierUpper`
   *  when no Pak rate exists at the matched tier. Optional so existing
   *  test fixtures stay valid; loader always provides an empty map at
   *  minimum, never undefined. */
  pakRateByTierUpper?: Map<number, number>;
}

export interface CarrierAccountSnapshot {
  id: string;
  /** Operator-visible name (e.g. 'FedEx Vietnam 2026'). Used by the
   *  order modal to label the cost-breakdown table. */
  name: string;
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
  /**
   * Country-scoped per-kg surcharge (FedEx Demand Surcharge and equivalents).
   * Sum across every active `demand_per_kg` row whose country_codes list
   * contains the destination — or whose list is NULL (catch-all).
   */
  demand: number;
  /**
   * Country-scoped FLAT per-shipment fee — e.g. FedEx VN "Phí xử lý hàng
   * nhập tại Hoa Kỳ" / US Duty Prepaid. Sum across every active
   * `country_fixed` row whose country_codes list contains the destination
   * (or is NULL = catch-all). Folded into the fuelable subtotal so fuel
   * applies on top — matches the invoice math we verified.
   */
  countryFixed: number;
  /**
   * Effective VAT % that was applied (sum of active `vat_percent` rows —
   * usually a single row). Surfaced so the modal can label the line
   * "VAT (8 %)" without re-querying the snapshot.
   */
  vatPercent: number;
  /** VAT amount: (base + surcharges + fuel) × vatPercent / 100. */
  vat: number;
  markup: number;
  subtotalBeforeMarkup: number;
  /** What we pay the carrier (subtotalBeforeMarkup), in cost currency. */
  carrierCost: number;
  /** Same as `carrierCost` but converted via `fxCostPerDisplay`. */
  carrierCostDisplay: number;
  /** Customer-facing offer: subtotalBeforeMarkup + markup, in cost currency. */
  finalCost: number;
  /** Same as `finalCost` but in display currency. */
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

  // Package-type selection follows the operator's business rule for FedEx:
  // shipments under 2 kg ship in a Pak (envelope/bag), 2 kg and up ship as
  // a Package (box). Pak rates are sparse — only published for the low
  // tiers — so we fall back to Package when no Pak rate exists at the
  // matched tier.
  const usePak = input.weightKg < 2;
  const pakBase = usePak ? zone.pakRateByTierUpper?.get(tier.upperKg) : undefined;
  const base = pakBase ?? zone.rateByTierUpper.get(tier.upperKg);
  if (base === undefined) {
    return {
      ok: false,
      code: 'rate_cell_missing',
      message: `No rate cell for zone ${zone.label} at tier ${tier.upperKg} kg.`,
    };
  }
  if (usePak && pakBase !== undefined) notes.push('pak');
  else if (usePak) notes.push('pak_fallback_to_package');

  const peak = sumActiveOfKind(snap.surcharges, 'peak_fixed');

  const perKgUnit = sumActiveOfKind(snap.surcharges, 'per_kg_fixed');
  const perKg = perKgUnit * input.weightKg;

  // FedEx Demand Surcharge: per-kg rate applied when the destination country
  // is in the row's country_codes list. NULL country_codes means catch-all.
  // Multiple matching rows COMPOUND — FedEx publishes overlapping regional +
  // peak-week demand surcharges that both apply.
  const demandUnit = snap.surcharges
    .filter((s) => s.active && s.kind === 'demand_per_kg')
    .filter((s) => !s.countryCodes || s.countryCodes.includes(country))
    .reduce((sum, s) => sum + s.value, 0);
  const demand = demandUnit * input.weightKg;

  // Country-scoped FLAT per-shipment fee. Sum every active country_fixed
  // row whose country_codes list contains the destination (or is NULL =
  // catch-all). Same compounding semantics as demand_per_kg.
  const countryFixed = snap.surcharges
    .filter((s) => s.active && s.kind === 'country_fixed')
    .filter((s) => !s.countryCodes || s.countryCodes.includes(country))
    .reduce((sum, s) => sum + s.value, 0);

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

  // Carrier billing model: fuel surcharge is charged as a % of the entire
  // freight + accessorial subtotal — NOT just the base rate. So fuel
  // applies to (base + peak + remote + residential + perKg + demand +
  // countryFixed). VAT then applies to (everything-incl-fuel). Markup is
  // our operator margin layered on top of the VAT-inclusive carrier bill.
  const fuelable = base + peak + remote + residential + perKg + demand + countryFixed;
  const fuelPct = sumActiveOfKind(snap.surcharges, 'fuel_percent');
  const fuel = fuelable * (fuelPct / 100);

  // VAT applies to base + surcharges + fuel. Operator-configurable rate
  // (FedEx VN: 8 %; other jurisdictions vary). Multiple active rows sum,
  // matching the existing convention for other percentage surcharges.
  const vatable = fuelable + fuel;
  const vatPct = sumActiveOfKind(snap.surcharges, 'vat_percent');
  const vat = vatable * (vatPct / 100);

  const subtotalBeforeMarkup = vatable + vat;
  const markupPct = sumActiveOfKind(snap.surcharges, 'markup_percent');
  const markup = subtotalBeforeMarkup * (markupPct / 100);
  const finalCost = Math.round(subtotalBeforeMarkup + markup);
  const finalDisplay = Math.round((finalCost / snap.fxCostPerDisplay) * 100) / 100;

  // What we PAY the carrier — pre-markup, in the carrier's cost currency
  // and its display equivalent. Distinct from `finalCost` (which includes
  // our markup, i.e. the customer-facing offer).
  const carrierCost = Math.round(subtotalBeforeMarkup);
  const carrierCostDisplay = Math.round((carrierCost / snap.fxCostPerDisplay) * 100) / 100;

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
      demand: Math.round(demand),
      countryFixed: Math.round(countryFixed),
      vatPercent: vatPct,
      vat: Math.round(vat),
      markup: Math.round(markup),
      subtotalBeforeMarkup: Math.round(subtotalBeforeMarkup),
      carrierCost,
      carrierCostDisplay,
      finalCost,
      finalDisplay,
    },
    notes,
  };
}
