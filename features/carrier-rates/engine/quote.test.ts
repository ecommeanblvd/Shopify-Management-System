import { describe, it, expect } from 'vitest';
import { quote, type CarrierAccountSnapshot } from './quote';

function makeSnap(overrides: Partial<CarrierAccountSnapshot> = {}): CarrierAccountSnapshot {
  const rateByTierUpper = new Map<number, number>([
    [0.5, 200_000],
    [1, 280_000],
    [2, 360_000],
    [5, 600_000],
  ]);
  return {
    id: 'acc-1',
    name: 'Test Account',
    costCurrency: 'VND',
    displayCurrency: 'USD',
    fxCostPerDisplay: 26_000,
    weightTiers: [{ upperKg: 0.5 }, { upperKg: 1 }, { upperKg: 2 }, { upperKg: 5 }],
    zonesByCountry: new Map([
      ['SG', { label: 'Zone 1', rateByTierUpper }],
      ['MY', { label: 'Zone 1', rateByTierUpper }],
      ['TH', { label: 'Zone 1', rateByTierUpper }],
    ]),
    surcharges: [],
    remotePostcodes: new Map(),
    ...overrides,
  };
}

describe('quote engine', () => {
  describe('happy paths', () => {
    it('base rate only, no surcharges', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.zone).toBe('Zone 1');
      expect(r.tier).toEqual({ upperKg: 1, index: 1 });
      expect(r.breakdown.base).toBe(280_000);
      expect(r.breakdown.finalCost).toBe(280_000);
      expect(r.breakdown.finalDisplay).toBeCloseTo(280_000 / 26_000, 2);
    });

    it('spec §14 worked example — Zone 1, 1 kg, fuel 30%, markup 12%', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([['TH', { label: 'Zone 1', rateByTierUpper: new Map([[1, 280_000]]) }]]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'fuel_percent', value: 30, active: true },
          { kind: 'markup_percent', value: 12, active: true },
          { kind: 'remote_fixed', value: 150_000, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'TH' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // base 280_000, fuel 84_000, subtotal 364_000, markup 43_680, final 407_680
      expect(r.breakdown.base).toBe(280_000);
      expect(r.breakdown.fuel).toBe(84_000);
      expect(r.breakdown.subtotalBeforeMarkup).toBe(364_000);
      expect(r.breakdown.markup).toBe(43_680);
      expect(r.breakdown.finalCost).toBe(407_680);
      expect(r.breakdown.finalDisplay).toBeCloseTo(15.68, 2);
    });

    it('spec §14 example with remote postcode hit adds the remote fixed fee', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([['TH', { label: 'Zone 1', rateByTierUpper: new Map([[1, 280_000]]) }]]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'fuel_percent', value: 30, active: true },
          { kind: 'markup_percent', value: 12, active: true },
          { kind: 'remote_fixed', value: 150_000, active: true },
        ],
        remotePostcodes: new Map([['TH', new Map([['REMOTE-1', null]])]]),
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'TH', destinationPostcode: 'REMOTE-1' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.remote).toBe(150_000);
      // Fuel applies to (base + remote) = 430,000 × 30% = 129,000
      expect(r.breakdown.fuel).toBe(129_000);
      expect(r.breakdown.subtotalBeforeMarkup).toBe(559_000); // 430 + 129 fuel
      expect(r.breakdown.carrierCost).toBe(559_000);
      expect(r.breakdown.markup).toBe(67_080); // 12% of 559_000
      expect(r.breakdown.finalCost).toBe(626_080);
      expect(r.breakdown.finalDisplay).toBeCloseTo(24.08, 2);
    });

    describe('demand surcharge (country-scoped per-kg)', () => {
      it('applies when destination is in the country list and scales by weight', () => {
        const snap = makeSnap({
          surcharges: [
            { kind: 'demand_per_kg', value: 10_000, active: true, countryCodes: ['SG', 'MY'] },
          ],
        });
        const r = quote(snap, { weightKg: 2, destinationCountry: 'SG' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.demand).toBe(20_000); // 10,000 × 2 kg
        // Fuel applies to (base + demand) = 360,000 + 20,000 = 380,000 × 0% = 0
        expect(r.breakdown.subtotalBeforeMarkup).toBe(380_000);
      });

      it('does NOT apply when destination is outside the country list', () => {
        const snap = makeSnap({
          surcharges: [
            { kind: 'demand_per_kg', value: 10_000, active: true, countryCodes: ['SG'] },
          ],
        });
        const r = quote(snap, { weightKg: 2, destinationCountry: 'MY' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.demand).toBe(0);
      });

      it('NULL country_codes acts as catch-all (every destination)', () => {
        const snap = makeSnap({
          surcharges: [
            { kind: 'demand_per_kg', value: 5_000, active: true, countryCodes: null },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'TH' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.demand).toBe(5_000);
      });

      it('multiple matching rows COMPOUND (regional + peak-week)', () => {
        const snap = makeSnap({
          surcharges: [
            { kind: 'demand_per_kg', value: 8_000, active: true, countryCodes: ['SG', 'MY', 'TH'] },
            { kind: 'demand_per_kg', value: 12_000, active: true, countryCodes: ['SG'] },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.demand).toBe(20_000); // (8,000 + 12,000) × 1 kg
      });

      it('fuel surcharge applies on top of demand (consistent with the carrier billing model)', () => {
        const snap = makeSnap({
          zonesByCountry: new Map([['TH', { label: 'Zone 1', rateByTierUpper: new Map([[1, 280_000]]) }]]),
          weightTiers: [{ upperKg: 1 }],
          surcharges: [
            { kind: 'fuel_percent', value: 30, active: true },
            { kind: 'demand_per_kg', value: 10_000, active: true, countryCodes: ['TH'] },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'TH' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // base 280k + demand 10k = 290k; fuel = 290k × 30% = 87k
        expect(r.breakdown.demand).toBe(10_000);
        expect(r.breakdown.fuel).toBe(87_000);
        expect(r.breakdown.subtotalBeforeMarkup).toBe(377_000);
      });

      it('inactive rows are ignored', () => {
        const snap = makeSnap({
          surcharges: [
            { kind: 'demand_per_kg', value: 10_000, active: false, countryCodes: ['SG'] },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.demand).toBe(0);
      });
    });

    describe('VAT', () => {
      it('applies on (base + surcharges + fuel) — FedEx Vietnam 8 %', () => {
        const snap = makeSnap({
          zonesByCountry: new Map([['TH', { label: 'Zone 1', rateByTierUpper: new Map([[1, 280_000]]) }]]),
          weightTiers: [{ upperKg: 1 }],
          surcharges: [
            { kind: 'fuel_percent', value: 30, active: true },
            { kind: 'vat_percent', value: 8, active: true },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'TH' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // base 280k, fuel 84k, vatable 364k, VAT 8% = 29,120
        expect(r.breakdown.fuel).toBe(84_000);
        expect(r.breakdown.vatPercent).toBe(8);
        expect(r.breakdown.vat).toBe(29_120);
        // carrierCost = vatable + vat = 364,000 + 29,120 = 393,120
        expect(r.breakdown.carrierCost).toBe(393_120);
      });

      it('VAT applies on top of every accessorial (peak + remote + demand + fuel)', () => {
        const snap = makeSnap({
          zonesByCountry: new Map([['TH', { label: 'Zone 1', rateByTierUpper: new Map([[1, 100_000]]) }]]),
          weightTiers: [{ upperKg: 1 }],
          surcharges: [
            { kind: 'peak_fixed', value: 20_000, active: true },
            { kind: 'demand_per_kg', value: 10_000, active: true, countryCodes: ['TH'] },
            { kind: 'fuel_percent', value: 50, active: true },
            { kind: 'vat_percent', value: 10, active: true },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'TH' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // fuelable = 100 + 20 + 10 = 130k
        // fuel = 130k × 50% = 65k
        // vatable = 195k
        // vat = 195k × 10% = 19,500
        expect(r.breakdown.fuel).toBe(65_000);
        expect(r.breakdown.vat).toBe(19_500);
        expect(r.breakdown.carrierCost).toBe(214_500);
      });

      it('zero VAT row → vat = 0 (catch-all that nothing matches)', () => {
        const snap = makeSnap({
          surcharges: [],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.vat).toBe(0);
        expect(r.breakdown.vatPercent).toBe(0);
      });

      it('inactive VAT row is ignored', () => {
        const snap = makeSnap({
          surcharges: [{ kind: 'vat_percent', value: 8, active: false }],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.vat).toBe(0);
      });

      it('markup compounds on VAT-inclusive carrier cost', () => {
        const snap = makeSnap({
          zonesByCountry: new Map([['SG', { label: 'Zone 1', rateByTierUpper: new Map([[1, 100_000]]) }]]),
          weightTiers: [{ upperKg: 1 }],
          surcharges: [
            { kind: 'vat_percent', value: 10, active: true },
            { kind: 'markup_percent', value: 20, active: true },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        // base 100k, vat 10k, carrierCost 110k, markup 110k × 20% = 22k
        expect(r.breakdown.carrierCost).toBe(110_000);
        expect(r.breakdown.markup).toBe(22_000);
        expect(r.breakdown.finalCost).toBe(132_000);
      });
    });

    describe('country_fixed (flat per-shipment country-scoped fee)', () => {
      it('applies the flat fee when destination is in country_codes', () => {
        const snap = makeSnap({
          zonesByCountry: new Map([
            ['US', { label: 'Zone D', rateByTierUpper: new Map([[5, 600_000]]) }],
          ]),
          weightTiers: [{ upperKg: 5 }],
          surcharges: [
            { kind: 'country_fixed', value: 68_300, active: true, countryCodes: ['US', 'PR'] },
          ],
        });
        const r = quote(snap, { weightKg: 3.5, destinationCountry: 'US' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.countryFixed).toBe(68_300);
      });

      it('skips when destination is outside country_codes', () => {
        const snap = makeSnap({
          surcharges: [
            { kind: 'country_fixed', value: 68_300, active: true, countryCodes: ['US'] },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'TH' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.countryFixed).toBe(0);
      });

      it('reproduces FedEx invoice for #MBLVD28990 (US Zone D, 3.5 kg)', () => {
        // Real numbers from FedEx Cost-breakdown screenshot for #MBLVD28990:
        //   Base                            ₫2,244,600  (post-discount in our sheet)
        //   Phí xử lý hàng nhập tại Hoa Kỳ      68,300
        //   PHỤ PHÍ NHIÊN LIỆU                 346,453  ≈ 15% of (base + handling)
        //   Vietnam VAT 8%                      89,457  on subtotal AFTER discount
        //                                  ──────────
        //   Total                            1,207,668
        //
        // For this engine test the rate sheet (post-discount) holds the
        // base ALREADY net of FedEx discount. So:
        //   base = ₫703,458  (= 2,244,600 - 1,541,142 discount)
        //   + US handling     68,300
        //   = fuelable       771,758
        //   × (1 + fuel%)
        //   + VAT 8%
        //   = 1,207,668
        // Fuel% required: see math below.
        const snap = makeSnap({
          zonesByCountry: new Map([['US', { label: 'Zone D', rateByTierUpper: new Map([[3.5, 703_458]]) }]]),
          weightTiers: [{ upperKg: 3.5 }],
          surcharges: [
            { kind: 'country_fixed', value: 68_300, active: true, countryCodes: ['US'] },
            { kind: 'fuel_percent', value: 44.89, active: true },
            { kind: 'vat_percent', value: 8, active: true },
          ],
        });
        const r = quote(snap, { weightKg: 3.5, destinationCountry: 'US' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.base).toBe(703_458);
        expect(r.breakdown.countryFixed).toBe(68_300);
        // fuelable = 771,758 × 0.4489 = 346,442 (rounded)
        // Tolerance ±50 covers the slight fuel% rounding (real FedEx
        // figure used 15% on pre-discount; we approximate to 44.89%
        // on post-discount, off by ~10 VND).
        expect(r.breakdown.fuel).toBeCloseTo(346_452, -2);
        expect(r.breakdown.vat).toBeCloseTo(89_457, -2);
        expect(r.breakdown.carrierCost).toBeCloseTo(1_207_668, -2);
      });
    });

    it('rounds up to the next tier (1.2 kg → 2 kg tier)', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 1.2, destinationCountry: 'MY' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.tier.upperKg).toBe(2);
      expect(r.breakdown.base).toBe(360_000);
    });

    it('residential surcharge applies only when flag is true', () => {
      const snap = makeSnap({
        surcharges: [{ kind: 'residential_fixed', value: 50_000, active: true }],
      });
      const noRes = quote(snap, { weightKg: 1, destinationCountry: 'SG', isResidential: false });
      const withRes = quote(snap, { weightKg: 1, destinationCountry: 'SG', isResidential: true });
      expect(noRes.ok && noRes.breakdown.residential).toBe(0);
      expect(withRes.ok && withRes.breakdown.residential).toBe(50_000);
    });

    it('per-kg fixed surcharge scales with weight (DHL SAF model)', () => {
      const snap = makeSnap({
        surcharges: [{ kind: 'per_kg_fixed', value: 3_800, active: true }],
      });
      const r = quote(snap, { weightKg: 2, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.perKg).toBe(7_600); // 3,800 × 2
    });

    it('disabled surcharges are ignored', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'fuel_percent', value: 30, active: false },
          { kind: 'markup_percent', value: 12, active: false },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.fuel).toBe(0);
      expect(r.breakdown.markup).toBe(0);
      expect(r.breakdown.finalCost).toBe(280_000);
    });

    it('multiple active surcharges of the same kind sum together', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'peak_fixed', value: 100_000, active: true },
          { kind: 'peak_fixed', value: 50_000, active: true },
          { kind: 'peak_fixed', value: 999_999, active: false }, // ignored
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok && r.breakdown.peak).toBe(150_000);
    });

    it('matches the tier-specific remote_fixed surcharge by postcode tier', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 1_170_000, active: true, tier: 'Tier A' },
          { kind: 'remote_fixed', value: 780_000,   active: true, tier: 'Tier B' },
          { kind: 'remote_fixed', value: 650_000,   active: true, tier: 'Tier C' },
        ],
        remotePostcodes: new Map([['SG', new Map([
          ['018989', 'Tier A'],
          ['208000', 'Tier B'],
          ['460000', 'Tier C'],
        ])]]),
      });
      const a = quote(snap, { weightKg: 1, destinationCountry: 'SG', destinationPostcode: '018989' });
      const b = quote(snap, { weightKg: 1, destinationCountry: 'SG', destinationPostcode: '208000' });
      const c = quote(snap, { weightKg: 1, destinationCountry: 'SG', destinationPostcode: '460000' });
      expect(a.ok && a.breakdown.remote).toBe(1_170_000);
      expect(b.ok && b.breakdown.remote).toBe(780_000);
      expect(c.ok && c.breakdown.remote).toBe(650_000);
    });

    it('catch-all surcharge (no tier) applies to every match alongside tiered ones', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 1_000_000, active: true, tier: 'Tier A' },
          { kind: 'remote_fixed', value: 50_000,    active: true, tier: null }, // base remote handling
        ],
        remotePostcodes: new Map([['SG', new Map([['ZIP-1', 'Tier A']])]]),
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG', destinationPostcode: 'ZIP-1' });
      expect(r.ok && r.breakdown.remote).toBe(1_050_000);
    });

    it('applies max(value, valuePerKg × weight) — FedEx ODA Tier B/C model', () => {
      // Tier B: 550,000 VND/shipment OR 9,200 VND/kg, whichever higher.
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 550_000, valuePerKg: 9_200, active: true, tier: 'Tier B' },
        ],
        remotePostcodes: new Map([['SG', new Map([['ZIP-B', 'Tier B']])]]),
      });
      // 1 kg: per-kg = 9,200 → 550,000 wins
      const light = quote(snap, { weightKg: 1, destinationCountry: 'SG', destinationPostcode: 'ZIP-B' });
      // 100 kg: per-kg = 920,000 → per-kg wins
      const heavy = quote(snap, { weightKg: 100, destinationCountry: 'SG', destinationPostcode: 'ZIP-B' });
      expect(light.ok && light.breakdown.remote).toBe(550_000);
      expect(heavy.ok && heavy.breakdown.remote).toBe(920_000);
    });

    it('valuePerKg=0 or missing falls back to plain value (Tier A model)', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 82_200, valuePerKg: null, active: true, tier: 'Tier A' },
        ],
        remotePostcodes: new Map([['SG', new Map([['ZIP-A', 'Tier A']])]]),
      });
      const r = quote(snap, { weightKg: 50, destinationCountry: 'SG', destinationPostcode: 'ZIP-A' });
      expect(r.ok && r.breakdown.remote).toBe(82_200);
    });

    it('skips remote surcharges whose tier does not match the postcode tier', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 999_999, active: true, tier: 'Tier B' },
        ],
        remotePostcodes: new Map([['SG', new Map([['ZIP-A', 'Tier A']])]]),
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG', destinationPostcode: 'ZIP-A' });
      // matched the postcode but no Tier A surcharge → remote stays 0
      expect(r.ok && r.breakdown.remote).toBe(0);
    });

    it('emits a note when the weight exceeds the top tier', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 10, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.notes).toContain('weight_exceeds_top_tier (5 kg)');
      expect(r.tier.upperKg).toBe(5);
    });
  });

  describe('error paths', () => {
    it('returns invalid_weight when weight ≤ 0', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 0, destinationCountry: 'SG' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('invalid_weight');
    });

    it('returns invalid_country for non-ISO-2', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 1, destinationCountry: 'XYZ' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('invalid_country');
    });

    it('returns no_zone when country is not mapped', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 1, destinationCountry: 'VN' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('no_zone');
    });

    it('returns no_tiers when account has no weight tiers', () => {
      const snap = makeSnap({ weightTiers: [] });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('no_tiers');
    });

    it('returns rate_cell_missing when zone lacks a cell for the picked tier', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([['SG', { label: 'Zone 1', rateByTierUpper: new Map() }]]),
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('rate_cell_missing');
    });

    it('returns invalid_fx when FX rate ≤ 0', () => {
      const snap = makeSnap({ fxCostPerDisplay: 0 });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('invalid_fx');
    });
  });
});
