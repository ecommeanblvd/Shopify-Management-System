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
  | 'vat_percent'
  | 'per_step_fixed'
  | 'contract_discount_pct';

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
  /**
   * Weight step in kg for `per_step_fixed` surcharges. Engine applies
   * `ceil(weightKg / stepKg) × value`. Required when kind='per_step_fixed'.
   */
  stepKg?: number | null;
  /**
   * Per-row override for whether this surcharge participates in the
   * fuelable subtotal. NULL → use kind default (see isFuelable below).
   *
   * Allows the same kind to be fuelable for one carrier and not for
   * another — e.g. DHL Elevated Risk (country_fixed, fuelable=true) vs
   * FedEx VN US-import-handling (country_fixed, fuelable=false).
   */
  fuelable?: boolean | null;
  /**
   * Effective-from / effective-to bounds. NULL on either side means
   * "unbounded that direction". Engine considers a row applicable for
   * a given effectiveDate when:
   *   (startsAt == null || startsAt <= effectiveDate)
   *   AND (endsAt == null || endsAt > effectiveDate)
   * The fuel-fetcher uses these to time-version weekly rates so an
   * order from 29/04 keeps quoting against the CW 18 fuel rate even
   * after the cron has refreshed the value for the current week.
   */
  startsAt?: Date | null;
  endsAt?: Date | null;
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
  /**
   * Volumetric divisor in cm³/kg for chargeable-weight calc:
   *   dimWeightKg = L_cm × W_cm × H_cm / dimDivisorCm3PerKg
   *   chargeableKg = max(actualKg, dimWeightKg)
   * FedEx/DHL Air = 5000 (default). NULL = skip dim-weight; engine
   * charges actual weight regardless of dimensions.
   */
  dimDivisorCm3PerKg?: number | null;
  /**
   * Rounding step applied to chargeable weight BEFORE tier lookup.
   * NULL = use raw computed value (DHL — engine takes
   * `first tier.upperKg >= chargeable`, so 2.52 → tier 3).
   * 0.5 = FedEx 2-step rule (verified across 7 distinct dim_weights
   * on 2026-06-03):
   *    a) round to nearest 0.1 kg
   *    b) ceiling to next 0.5 kg
   *  Examples:
   *    2.04 → 2.0 → 2.0
   *    2.355 → 2.4 → 2.5
   *    2.52 → 2.5 → 2.5
   *    3.75 → 3.8 → 4.0
   *    5.58 → 5.6 → 6.0
   */
  chargeableRoundingKg?: number | null;
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
  /**
   * Scale (actual) weight of the shipment in kg. The engine charges
   * `max(weightKg, dimWeightKg)` when dimensions are provided AND the
   * snapshot has a `dimDivisorCm3PerKg` — otherwise it charges
   * `weightKg` directly. NEVER pass the dim weight pre-computed; let
   * the engine derive it so the breakdown reports both numbers.
   */
  weightKg: number;
  /**
   * Pack dimensions in cm. All three must be set for dim-weight to
   * fire. If any is missing the engine quietly falls back to
   * `weightKg`. The operator's Excel cột AC stores these as
   * "L×W×H" — split before passing in.
   */
  dimensions?: { lengthCm: number; widthCm: number; heightCm: number } | null;
  /**
   * Packaging form factor — drives which rate matrix the engine reads:
   *   'bag' → Pak rate (envelope/soft pouch, lower at light tiers)
   *   'box' → Package rate (rigid box, full FedEx published)
   * When NULL/undefined, engine falls back to the legacy weight rule
   * (<2 kg → Pak, ≥2 kg → Package) for backwards compatibility with
   * orders that haven't been imported via the shipments table yet.
   */
  packagingType?: 'bag' | 'box' | null;
  destinationCountry: string;
  destinationPostcode?: string;
  /**
   * Destination city name. Used as a fallback key for the remote-area
   * lookup when the carrier's surcharge list is published by city
   * instead of by postal code — e.g. FedEx ODA Tier B for SA/AE/KW/QA/
   * OM/BH lists Jeddah, Riyadh, Abu Dhabi… with no postcode.
   *
   * Comparison is case-insensitive and trim-normalised. Stored
   * patterns are uppercased at import time so this stays a constant-
   * time Map.get().
   */
  destinationCity?: string;
  isResidential?: boolean;
  /**
   * Quote-time anchor for time-versioned surcharges. Defaults to now.
   * Pass the order's `processed_at_shopify` to reproduce the carrier's
   * historical rate sheet — crucial for re-pricing past orders whose
   * fuel surcharge has since changed (DHL publishes weekly).
   *
   * Rows with `startsAt > effectiveDate` or `endsAt <= effectiveDate`
   * are excluded for that quote. Rows with no date bounds (NULL) keep
   * applying always.
   */
  effectiveDate?: Date;
}

export interface QuoteBreakdown {
  /**
   * Scale weight the operator passed in (kg). Surfaced so the modal can
   * render "Actual 0.6 kg" alongside dim weight when they diverge.
   */
  actualWeightKg: number;
  /**
   * Dimensional weight derived from `dimensions × dimDivisor` (kg). Zero
   * when no dimensions / no divisor. Rounded to 3 dp for display.
   */
  dimWeightKg: number;
  /**
   * What the engine actually billed against: `max(actual, dim)`. Equal
   * to `actualWeightKg` when no dim provided.
   */
  chargeableWeightKg: number;
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
   * Sum of all active `per_step_fixed` contributions. Each row contributes
   * `ceil(weightKg / stepKg) × value` (e.g. DHL GoGreen 1,900 VND × every
   * 0.5 kg step). Default `fuelable = false`.
   */
  perStep: number;
  /**
   * Effective VAT % that was applied (sum of active `vat_percent` rows —
   * usually a single row). Surfaced so the modal can label the line
   * "VAT (8 %)" without re-querying the snapshot.
   */
  vatPercent: number;
  /** VAT amount: (base + surcharges + fuel − discount) × vatPercent / 100. */
  vat: number;
  /**
   * Sum of contract_discount_pct rows that matched the destination,
   * expressed as a PERCENTAGE (e.g. 70 means 70 % off base). Surfaced so
   * the modal can label the line "Volume discount (70 %)" without
   * re-querying the snapshot. Zero when no discount applies.
   */
  discountPercent: number;
  /**
   * VND amount deducted from the published base via the contract volume
   * discount: `base × discountPercent / 100`. Already factored into
   * `vatable` / `vat` / `carrierCost` — surfaced as a positive number on
   * the breakdown so the modal can render it as a separate line with a
   * "−" sign.
   */
  discount: number;
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

/**
 * Active + within the (optional) start/end window for the given quote
 * date. Rows without bounds keep applying as before, so existing data
 * (with both columns NULL) is unaffected. The fuel-fetcher uses these
 * bounds to time-version weekly rates without losing historical context.
 */
function isApplicable(s: SurchargeSnap, effectiveDate: Date): boolean {
  if (!s.active) return false;
  const t = effectiveDate.getTime();
  if (s.startsAt && s.startsAt.getTime() > t) return false;
  if (s.endsAt && s.endsAt.getTime() <= t) return false;
  return true;
}

function sumApplicableOfKind(
  surcharges: SurchargeSnap[], kind: SurchargeKind, effectiveDate: Date,
): number {
  return surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === kind)
    .reduce((sum, s) => sum + s.value, 0);
}

/**
 * Decides whether a surcharge participates in the fuelable subtotal.
 *
 * Per-row override (`s.fuelable`) wins. If NULL, defaults per kind:
 *   peak_fixed, remote_fixed, residential_fixed, per_kg_fixed
 *     → true (transport-cost surcharges fuel applies on top of)
 *   demand_per_kg, country_fixed, per_step_fixed
 *     → false (destination-side fees / environmental fees that sit
 *       OUTSIDE the fuelable subtotal — verified per the operator's
 *       LOG-Export invoice column AK on 2026-06-03 across MBLVD28959,
 *       MBLVD28988, etc.: fuel = pct × (effective_base + remote), so
 *       FedEx Demand Surcharge is NOT in the fuel base. DHL Elevated
 *       Risk (country_fixed) DOES need fuel — set per-row override.)
 *
 * The per-row override lets a single kind behave differently between
 * carriers — DHL Elevated Risk (country_fixed, fuelable=true) vs FedEx VN
 * US-import-handling (country_fixed, fuelable=false) being the canonical
 * case the column was added for.
 */
function isFuelable(s: SurchargeSnap): boolean {
  if (s.fuelable === true) return true;
  if (s.fuelable === false) return false;
  switch (s.kind) {
    case 'peak_fixed':
    case 'remote_fixed':
    case 'residential_fixed':
    case 'per_kg_fixed':
      return true;
    case 'demand_per_kg':
    case 'country_fixed':
    case 'per_step_fixed':
    case 'fuel_percent':
    case 'markup_percent':
    case 'vat_percent':
    // Discount is NEVER fuelable — fuel% is published by the carrier on
    // the PUBLISHED base, not the discounted base (verified via Excel
    // row 22: fuel/published_base ≈ 17 %; fuel/effective_base ≈ 55 %
    // which is not a real fuel rate). Discount is its own line item
    // that reduces the VATable subtotal, applied after fuel is added.
    case 'contract_discount_pct':
      return false;
  }
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
  effectiveDate: Date,
): number {
  return surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'remote_fixed')
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

  // Dimensional weight — chargeableWeight = max(actual, L×W×H/divisor).
  // Falls back to actual weight when dimensions or divisor missing.
  // 3-dp rounding matches operator's standard report precision.
  let dimWeightKg = 0;
  if (
    input.dimensions &&
    snap.dimDivisorCm3PerKg &&
    snap.dimDivisorCm3PerKg > 0 &&
    input.dimensions.lengthCm > 0 &&
    input.dimensions.widthCm > 0 &&
    input.dimensions.heightCm > 0
  ) {
    const volume = input.dimensions.lengthCm * input.dimensions.widthCm * input.dimensions.heightCm;
    dimWeightKg = Math.round((volume / snap.dimDivisorCm3PerKg) * 1000) / 1000;
  }
  const rawChargeable = Math.max(input.weightKg, dimWeightKg);
  if (dimWeightKg > input.weightKg) notes.push(`dim_weight (${dimWeightKg} kg)`);

  // Carrier-specific rounding before tier lookup. When set, the rule
  // is FedEx 2-step: round to nearest 0.1 kg, then ceiling to next
  // multiple of `chargeableRoundingKg` (typically 0.5). DHL uses raw.
  let chargeableWeightKg = rawChargeable;
  if (snap.chargeableRoundingKg && snap.chargeableRoundingKg > 0) {
    const step = snap.chargeableRoundingKg;
    const oneTenth = Math.round(rawChargeable * 10) / 10;
    chargeableWeightKg = Math.ceil((oneTenth - 1e-9) / step) * step;
    // Round to 3 dp to clean float drift on multiplication.
    chargeableWeightKg = Math.round(chargeableWeightKg * 1000) / 1000;
    if (chargeableWeightKg !== rawChargeable) {
      notes.push(`chargeable_rounded (${rawChargeable} → ${chargeableWeightKg} kg)`);
    }
  }

  // Find first tier whose upperKg ≥ chargeable weight. If none, use the
  // last tier and warn. Chargeable weight drives EVERY rate/surcharge
  // calc below — fuel%/per-kg/per-step all apply on it.
  let tierIndex = snap.weightTiers.findIndex((t) => t.upperKg >= chargeableWeightKg);
  if (tierIndex === -1) {
    tierIndex = snap.weightTiers.length - 1;
    notes.push(`weight_exceeds_top_tier (${snap.weightTiers[tierIndex].upperKg} kg)`);
  }
  const tier = snap.weightTiers[tierIndex];

  // Package-type selection:
  //   1. Explicit `packagingType` wins — operator imported the Excel
  //      pack record and we KNOW it shipped in a bag or a box.
  //   2. Fallback rule (legacy): weight < 2 kg → Pak. Used when no
  //      shipment record exists yet (order modal quoting orders that
  //      pre-date the Phase 2 importer).
  // Pak rates are sparse — only published for the low tiers — so we
  // fall back to Package when no Pak rate exists at the matched tier.
  const usePak = input.packagingType === 'bag'
    ? true
    : input.packagingType === 'box'
      ? false
      : chargeableWeightKg < 2;
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

  // Anchor every surcharge gate to a single moment so the same row is
  // either applicable for the whole quote or not at all.
  const effectiveDate = input.effectiveDate ?? new Date();

  const peak = sumApplicableOfKind(snap.surcharges, 'peak_fixed', effectiveDate);

  const perKgUnit = sumApplicableOfKind(snap.surcharges, 'per_kg_fixed', effectiveDate);
  const perKg = perKgUnit * chargeableWeightKg;

  // FedEx Demand Surcharge: per-kg rate applied when the destination country
  // is in the row's country_codes list. NULL country_codes means catch-all.
  // Multiple matching rows COMPOUND — FedEx publishes overlapping regional +
  // peak-week demand surcharges that both apply.
  const demandUnit = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'demand_per_kg')
    .filter((s) => !s.countryCodes || s.countryCodes.includes(country))
    .reduce((sum, s) => sum + s.value, 0);
  const demand = demandUnit * chargeableWeightKg;

  // Country-scoped FLAT per-shipment fee. Sum every applicable country_fixed
  // row whose country_codes list contains the destination (or is NULL =
  // catch-all). Same compounding semantics as demand_per_kg.
  const countryFixed = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'country_fixed')
    .filter((s) => !s.countryCodes || s.countryCodes.includes(country))
    .reduce((sum, s) => sum + s.value, 0);

  // Remote-area lookup. Postcode first (more specific), then city
  // name fallback when the postcode isn't on the list. Both keys live
  // in the same per-country Map: postcodes are stored as-is (already
  // digits), city patterns are stored UPPERCASED at import time so
  // there's no collision between the two and lookup stays O(1).
  let remote = 0;
  let matchedTier: string | null | undefined;
  let matchedBy: 'postcode' | 'city' | null = null;
  const patterns = snap.remotePostcodes.get(country);
  if (patterns) {
    if (input.destinationPostcode) {
      const t = patterns.get(input.destinationPostcode.trim());
      if (t !== undefined) {
        matchedTier = t;
        matchedBy = 'postcode';
      }
    }
    if (matchedBy === null && input.destinationCity) {
      // Normalise: uppercase + strip non-alphanumeric. FedEx's source
      // is inconsistent (SA "ABAALWOROOD" vs BH "Durrat Al Bahrain"),
      // and incoming Shopify city values vary even more ("aba al
      // worood", "Aba Alworood"). Stripping all separators normalises
      // both sides. MUST stay in sync with the import script's
      // city-pattern normalisation.
      const cityKey = input.destinationCity.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (cityKey.length > 0) {
        const t = patterns.get(cityKey);
        if (t !== undefined) {
          matchedTier = t;
          matchedBy = 'city';
        }
      }
    }
  }
  if (matchedBy !== null) {
    // matchedTier may be null (no tier) or a label like 'Tier A'.
    remote = sumRemoteFixed(snap.surcharges, matchedTier ?? null, chargeableWeightKg, effectiveDate);
    const suffix = matchedTier ? ` (${matchedTier})` : '';
    notes.push(`remote_match:${matchedBy}${suffix}`);
  }

  const residential = input.isResidential
    ? sumApplicableOfKind(snap.surcharges, 'residential_fixed', effectiveDate)
    : 0;

  // Stepped per-weight surcharge — DHL GoGreen Plus and equivalents.
  // Each row contributes `ceil(weight / stepKg) × value`. Rows with
  // missing/invalid stepKg are skipped (defensive — shouldn't happen
  // because the loader would reject them).
  const perStep = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'per_step_fixed')
    .filter((s) => s.stepKg && s.stepKg > 0)
    .reduce((sum, s) => sum + Math.ceil(chargeableWeightKg / s.stepKg!) * s.value, 0);

  // Per-row fuelable check: helper computes the row's contributed amount
  // to the carrier bill, given its kind + the current quote inputs.
  // Rows that don't match (e.g. country_fixed for a different country)
  // return 0, so we never need to special-case them in the sums below.
  function rowContribution(s: SurchargeSnap): number {
    if (!isApplicable(s, effectiveDate)) return 0;
    switch (s.kind) {
      case 'peak_fixed':
        return s.value;
      case 'per_kg_fixed':
        return s.value * chargeableWeightKg;
      case 'demand_per_kg':
        return (!s.countryCodes || s.countryCodes.includes(country))
          ? s.value * chargeableWeightKg : 0;
      case 'country_fixed':
        return (!s.countryCodes || s.countryCodes.includes(country))
          ? s.value : 0;
      case 'per_step_fixed':
        return (s.stepKg && s.stepKg > 0)
          ? Math.ceil(chargeableWeightKg / s.stepKg) * s.value : 0;
      // remote / residential already handled via dedicated paths above
      // (postcode match / isResidential flag). Return 0 here so they
      // aren't double-counted. Discount handled via dedicated path below
      // (it's a deduction, not a positive contribution).
      case 'remote_fixed':
      case 'residential_fixed':
      case 'fuel_percent':
      case 'vat_percent':
      case 'markup_percent':
      case 'contract_discount_pct':
        return 0;
    }
  }

  // Sum of surcharge contributions split by fuelable eligibility. Remote
  // and residential already pre-computed above; bucketed here by their
  // representative kind (they're always fuelable by default; per-row
  // override on a remote_fixed / residential_fixed row still wins).
  let fuelableSurcharges = 0;
  let nonFuelableSurcharges = 0;
  for (const s of snap.surcharges) {
    const amt = rowContribution(s);
    if (amt === 0) continue;
    if (isFuelable(s)) fuelableSurcharges += amt;
    else nonFuelableSurcharges += amt;
  }
  // remote + residential are computed above; classify them by the default
  // (fuelable) since they have no per-row override path in v1.
  fuelableSurcharges += remote + residential;

  const fuelable = base + fuelableSurcharges;
  const fuelPct = sumApplicableOfKind(snap.surcharges, 'fuel_percent', effectiveDate);
  const fuel = fuelable * (fuelPct / 100);

  // Contract volume discount applies to the PUBLISHED base only. Per-zone
  // variation supported via `country_codes` — US-bound 68 %, SA-bound 77 %,
  // etc. NULL country_codes = catch-all. Multiple matching rows COMPOUND
  // (sum %), matching the carrier "stacked discount" semantics.
  // `discountAmount` is positive; subtracted from the VATable subtotal so
  // VAT applies on the post-discount total (verified vs invoice math
  // on 2026-06-03 across 4 sample rows).
  const discountPct = snap.surcharges
    .filter((s) => isApplicable(s, effectiveDate) && s.kind === 'contract_discount_pct')
    .filter((s) => !s.countryCodes || s.countryCodes.includes(country))
    .reduce((sum, s) => sum + s.value, 0);
  const discount = base * (discountPct / 100);

  // VAT covers the entire carrier bill regardless of fuel eligibility,
  // minus the contract discount (so VAT is on the negotiated total).
  const vatable = fuelable + fuel + nonFuelableSurcharges - discount;
  const vatPct = sumApplicableOfKind(snap.surcharges, 'vat_percent', effectiveDate);
  const vat = vatable * (vatPct / 100);

  const subtotalBeforeMarkup = vatable + vat;
  const markupPct = sumApplicableOfKind(snap.surcharges, 'markup_percent', effectiveDate);
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
      actualWeightKg: input.weightKg,
      dimWeightKg,
      chargeableWeightKg,
      base: Math.round(base),
      fuel: Math.round(fuel),
      peak: Math.round(peak),
      remote: Math.round(remote),
      residential: Math.round(residential),
      perKg: Math.round(perKg),
      demand: Math.round(demand),
      countryFixed: Math.round(countryFixed),
      perStep: Math.round(perStep),
      vatPercent: vatPct,
      vat: Math.round(vat),
      discountPercent: discountPct,
      discount: Math.round(discount),
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
