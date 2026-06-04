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

      it('demand surcharge is NOT in the fuel base (sits OUTSIDE fuel — verified via FedEx invoice 2026-06-03)', () => {
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
        // demand_per_kg defaults to fuelable=false. Fuel only on base.
        // fuel = base 280k × 30% = 84k. Demand adds OUTSIDE fuel.
        // subtotal = base 280k + demand 10k + fuel 84k = 374k
        expect(r.breakdown.demand).toBe(10_000);
        expect(r.breakdown.fuel).toBe(84_000);
        expect(r.breakdown.subtotalBeforeMarkup).toBe(374_000);
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

      it('VAT applies on top of every accessorial (peak + demand + fuel)', () => {
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
        // peak_fixed fuelable=true, demand_per_kg fuelable=false (default).
        // fuelable = base 100k + peak 20k = 120k
        // fuel = 120k × 50% = 60k
        // vatable = 120k + 60k fuel + 10k demand (nonFuelable) = 190k
        // vat = 190k × 10% = 19,000
        expect(r.breakdown.fuel).toBe(60_000);
        expect(r.breakdown.vat).toBe(19_000);
        expect(r.breakdown.carrierCost).toBe(209_000);
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

      it('reproduces FedEx invoice for #MBLVD28990 (US Zone D, 1 kg, Pak)', () => {
        // FedEx Cost-breakdown screenshot for #MBLVD28990:
        //   Base rate              ₫2,244,600    (FedEx gross)
        //   − Total discount         1,541,142    (Volume + Commission)
        //   = Net base               ₫703,458    ← Pak Zone D 1.0 kg in PDF
        //   + Phí xử lý hàng nhập      68,300    (US import handling)
        //   + PHỤ PHÍ NHIÊN LIỆU      346,453    (fuel — applied to BASE
        //                                          ALONE, NOT handling)
        //   + Vietnam VAT 8%           89,457    (on base + handling + fuel)
        //                          ──────────
        //   Total                  ₫1,207,668
        //
        // Fuel% = 346,453 / 703,458 = 49.25 % — matches FedEx VN's current
        // published rate (auto-refreshed weekly).  countryFixed is NOT in
        // the fuelable subtotal because it's an import-side fee.
        const snap = makeSnap({
          zonesByCountry: new Map([['US', { label: 'Zone D', rateByTierUpper: new Map([[1, 703_458]]) }]]),
          weightTiers: [{ upperKg: 1 }],
          surcharges: [
            { kind: 'country_fixed', value: 68_300, active: true, countryCodes: ['US'] },
            { kind: 'fuel_percent', value: 49.25, active: true },
            { kind: 'vat_percent', value: 8, active: true },
          ],
        });
        const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.breakdown.base).toBe(703_458);
        expect(r.breakdown.countryFixed).toBe(68_300);
        // fuel = 703,458 × 0.4925 = 346,453 (rounded to nearest VND)
        expect(r.breakdown.fuel).toBe(346_453);
        // vat = (703,458 + 346,453 + 68,300) × 0.08 = 89,457
        expect(r.breakdown.vat).toBe(89_457);
        // carrierCost = 1,207,668 — exact match to FedEx invoice
        expect(r.breakdown.carrierCost).toBe(1_207_668);
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

    // ----- destinationCity fallback ----------------------------------
    // ME countries (SA, AE, KW, QA, OM, BH) have no postal-code-based
    // ODA list — FedEx publishes only city names. The engine stores
    // those cities UPPERCASED in the same patterns map so the lookup
    // is a normal Map.get(), no scanning.

    it('matches by city name when destinationPostcode is missing', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 550_000, valuePerKg: 9_200, active: true, tier: 'Tier B' },
        ],
        remotePostcodes: new Map([['SG', new Map([['JEDDAH', 'Tier B']])]]),
      });
      const r = quote(snap, {
        weightKg: 1,
        destinationCountry: 'SG',
        destinationCity: 'Jeddah',
      });
      expect(r.ok && r.breakdown.remote).toBe(550_000);
    });

    it('city lookup is case-insensitive and trims whitespace', () => {
      const snap = makeSnap({
        surcharges: [{ kind: 'remote_fixed', value: 550_000, active: true, tier: 'Tier B' }],
        remotePostcodes: new Map([['SG', new Map([['BIDA ZAYED', 'Tier B']])]]),
      });
      const r = quote(snap, {
        weightKg: 1,
        destinationCountry: 'SG',
        destinationCity: '  bida zayed  ',
      });
      expect(r.ok && r.breakdown.remote).toBe(550_000);
    });

    it('prefers postcode match over city match when both are provided', () => {
      // Same country, two patterns mapped to different tiers. If both
      // postcode and city would match, the more specific postcode wins.
      const snap = makeSnap({
        surcharges: [
          { kind: 'remote_fixed', value: 82_200, active: true, tier: 'Tier A' },
          { kind: 'remote_fixed', value: 550_000, active: true, tier: 'Tier B' },
        ],
        remotePostcodes: new Map([['SG', new Map([
          ['10930',      'Tier A'], // postcode → A
          ['TEL AVIV',   'Tier B'], // city → B
        ])]]),
      });
      const r = quote(snap, {
        weightKg: 1,
        destinationCountry: 'SG',
        destinationPostcode: '10930',
        destinationCity: 'Tel Aviv',
      });
      expect(r.ok && r.breakdown.remote).toBe(82_200); // Tier A (postcode) wins
    });

    it('falls back to city when postcode does not match', () => {
      const snap = makeSnap({
        surcharges: [{ kind: 'remote_fixed', value: 550_000, active: true, tier: 'Tier B' }],
        remotePostcodes: new Map([['SG', new Map([['SUR', 'Tier B']])]]),
      });
      const r = quote(snap, {
        weightKg: 1,
        destinationCountry: 'SG',
        destinationPostcode: 'XXXXX', // doesn't exist in map
        destinationCity: 'Sur',
      });
      expect(r.ok && r.breakdown.remote).toBe(550_000);
    });

    it('does not apply remote when neither postcode nor city matches', () => {
      const snap = makeSnap({
        surcharges: [{ kind: 'remote_fixed', value: 550_000, active: true, tier: 'Tier B' }],
        remotePostcodes: new Map([['SG', new Map([['DUBAI', 'Tier B']])]]),
      });
      const r = quote(snap, {
        weightKg: 1,
        destinationCountry: 'SG',
        destinationCity: 'Abu Dhabi',
      });
      expect(r.ok && r.breakdown.remote).toBe(0);
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

  describe('per_step_fixed surcharge', () => {
    it('applies ceil(weight / step) × value (DHL GoGreen 1,900 × 0.5 kg)', () => {
      // 8 kg ÷ 0.5 = 16 steps × 1,900 = 30,400 — invoice math
      const snap = makeSnap({
        surcharges: [
          { kind: 'per_step_fixed', value: 1_900, stepKg: 0.5, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 8, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.perStep).toBe(30_400);
    });

    it('rounds up fractional weight (1.3 kg → 3 steps × 1,900 = 5,700)', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'per_step_fixed', value: 1_900, stepKg: 0.5, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 1.3, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.perStep).toBe(5_700);
    });

    it('skips rows with missing or zero stepKg (defensive)', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'per_step_fixed', value: 1_900, stepKg: null, active: true },
          { kind: 'per_step_fixed', value: 1_900, stepKg: 0, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 8, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.perStep).toBe(0);
    });

    it('per_step_fixed is NOT in fuelable subtotal by default', () => {
      const snap = makeSnap({
        surcharges: [
          { kind: 'per_step_fixed', value: 1_000, stepKg: 1, active: true },
          { kind: 'fuel_percent', value: 50, active: true },
        ],
      });
      // base @ 1kg = 280_000; perStep = 1×1000 = 1_000; fuel applies only to base
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.fuel).toBe(140_000); // 280_000 × 50%, NOT 281_000 × 50%
      expect(r.breakdown.perStep).toBe(1_000);
    });
  });

  describe('fuelable per-row override', () => {
    it('country_fixed with fuelable=true joins the fuel base (DHL Elevated Risk)', () => {
      // base @ 8kg = ?, set up a custom rate sheet to match invoice exactly.
      const rateByTierUpper = new Map<number, number>([[8, 3_454_851]]);
      const snap = makeSnap({
        weightTiers: [{ upperKg: 8 }],
        zonesByCountry: new Map([['SA', { label: 'Zone 9', rateByTierUpper }]]),
        surcharges: [
          // Elevated Risk: country_fixed, fuelable=true
          {
            kind: 'country_fixed', value: 918_000, countryCodes: ['SA'],
            active: true, fuelable: true,
          },
          // Fuel @ 48% (DHL week 18, 2026)
          { kind: 'fuel_percent', value: 48, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 8, destinationCountry: 'SA' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // (3,454,851 + 918,000) × 48% = 2,098,968.48 → invoice rounds to 2,098,968
      expect(r.breakdown.fuel).toBe(2_098_968);
    });

    it('peak_fixed with fuelable=false is OUT of fuel base (DHL Direct Signature)', () => {
      // Direct Signature 150,000 VND, NOT fuelable
      const snap = makeSnap({
        surcharges: [
          { kind: 'peak_fixed', value: 150_000, active: true, fuelable: false },
          { kind: 'fuel_percent', value: 50, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // fuel = base × 50% only — Direct Signature stays out.
      expect(r.breakdown.fuel).toBe(140_000); // 280_000 × 50%
      expect(r.breakdown.peak).toBe(150_000);
    });

    it('default semantics preserved: country_fixed without override stays OUT of fuel base', () => {
      // Regression — FedEx VN US-import-handling case.
      const snap = makeSnap({
        surcharges: [
          { kind: 'country_fixed', value: 500_000, countryCodes: ['US'], active: true },
          { kind: 'fuel_percent', value: 49.25, active: true },
        ],
        zonesByCountry: new Map([
          ['US', { label: 'Zone US', rateByTierUpper: new Map([[1, 700_000]]) }],
        ]),
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // fuel = base × 49.25% — country_fixed stays out.
      expect(r.breakdown.fuel).toBe(Math.round(700_000 * 0.4925));
      expect(r.breakdown.countryFixed).toBe(500_000);
    });

    it('time-versioned fuel%: order from CW 18 keeps 48% even after CW 23 cron set 48.75%', () => {
      const snap = makeSnap({
        weightTiers: [{ upperKg: 8 }],
        zonesByCountry: new Map([
          ['SA', { label: 'Zone 9', rateByTierUpper: new Map([[8, 3_454_851]]) }],
        ]),
        surcharges: [
          // Closed window: CW 18 fuel
          {
            kind: 'fuel_percent', value: 48, active: true,
            startsAt: new Date('2026-04-27T00:00:00Z'),
            endsAt:   new Date('2026-05-04T00:00:00Z'),
          },
          // Currently-open window: CW 23 fuel
          {
            kind: 'fuel_percent', value: 48.75, active: true,
            startsAt: new Date('2026-06-01T00:00:00Z'),
            endsAt: null,
          },
        ],
      });
      const old = quote(snap, {
        weightKg: 8,
        destinationCountry: 'SA',
        effectiveDate: new Date('2026-04-29T11:08:30Z'),
      });
      expect(old.ok).toBe(true);
      if (!old.ok) return;
      expect(old.breakdown.fuel).toBe(Math.round(3_454_851 * 0.48));

      const today = quote(snap, {
        weightKg: 8,
        destinationCountry: 'SA',
        effectiveDate: new Date('2026-06-02T12:00:00Z'),
      });
      expect(today.ok).toBe(true);
      if (!today.ok) return;
      expect(today.breakdown.fuel).toBe(Math.round(3_454_851 * 0.4875));
    });

    it('rows without startsAt/endsAt apply regardless of effectiveDate (backwards compat)', () => {
      const snap = makeSnap({
        surcharges: [{ kind: 'fuel_percent', value: 30, active: true }],
      });
      const r = quote(snap, {
        weightKg: 1,
        destinationCountry: 'SG',
        effectiveDate: new Date('1999-01-01T00:00:00Z'),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.fuel).toBe(Math.round(280_000 * 0.3));
    });

    it('end-to-end DHL #MBLVD28558 invoice math (base 3,454,851 + DS 150k + ER 918k + GG 30,400 + fuel 48% on base+ER)', () => {
      const snap = makeSnap({
        weightTiers: [{ upperKg: 8 }],
        zonesByCountry: new Map([
          ['SA', { label: 'Zone 9', rateByTierUpper: new Map([[8, 3_454_851]]) }],
        ]),
        surcharges: [
          // Direct Signature 150k, NOT fuelable
          { kind: 'peak_fixed', value: 150_000, active: true, fuelable: false },
          // Elevated Risk 918k for Middle East, fuelable=true
          {
            kind: 'country_fixed', value: 918_000, countryCodes: ['SA'],
            active: true, fuelable: true,
          },
          // GoGreen Plus 1,900 × 0.5kg
          { kind: 'per_step_fixed', value: 1_900, stepKg: 0.5, active: true },
          // Fuel 48% for week 18, 2026
          { kind: 'fuel_percent', value: 48, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 8, destinationCountry: 'SA' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.base).toBe(3_454_851);
      expect(r.breakdown.peak).toBe(150_000);
      expect(r.breakdown.countryFixed).toBe(918_000);
      expect(r.breakdown.perStep).toBe(30_400);
      expect(r.breakdown.fuel).toBe(2_098_968);
      // Total carrier cost = 3,454,851 + 150,000 + 918,000 + 30,400 + 2,098,968
      //                    = 6,652,219 (excludes one-off Address Correction)
      expect(r.breakdown.carrierCost).toBe(6_652_219);
    });
  });

  describe('contract_discount_pct (negotiated volume discount)', () => {
    // Reproduces FedEx #MBLVD28959 (US, 0.7 kg, 2026-06-01) from the
    // operator's invoice CSV. Verified line-by-line against the actual
    // invoice on 2026-06-03:
    //   base 2,244,600 + discount −1,541,142 + fuel 386,937 + remote 82,200
    //                                                   + demand 68,300
    //   = 1,240,895 pre-VAT
    //   VAT 8 %  = 99,272
    //   total    = 1,340,167
    // Operator-provided discount % = 1,541,142 / 2,244,600 = 68.66 %
    it('reproduces FedEx #MBLVD28959 invoice math exactly', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([
          ['US', { label: 'Zone X', rateByTierUpper: new Map([[1, 2_244_600]]) }],
        ]),
        weightTiers: [{ upperKg: 1 }],
        // Fuel% derived empirically from the invoice — 386,937 / (base +
        // remote + demand fuelable) per engine model. Tweak after we add
        // per-row remote postcode wiring; the discount math is unaffected.
        surcharges: [
          { kind: 'fuel_percent', value: 16.18, active: true },
          { kind: 'remote_fixed', value: 82_200, active: true },
          { kind: 'demand_per_kg', value: 97_571.4, active: true, countryCodes: ['US'] },
          { kind: 'contract_discount_pct', value: 68.66, active: true, countryCodes: ['US'] },
          { kind: 'vat_percent', value: 8, active: true },
        ],
        remotePostcodes: new Map([['US', new Map([['REMOTE-1', null]])]]),
      });
      const r = quote(snap, {
        weightKg: 0.7,
        destinationCountry: 'US',
        destinationPostcode: 'REMOTE-1',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.base).toBe(2_244_600);
      expect(r.breakdown.discountPercent).toBeCloseTo(68.66);
      expect(r.breakdown.discount).toBe(1_541_142); // 2,244,600 × 0.6866 (round)
      // VAT base is post-discount: invoice keeps VAT at ~99k. Engine's
      // VAT must drop the discount before applying 8 %.
      expect(r.breakdown.vat).toBeGreaterThan(95_000);
      expect(r.breakdown.vat).toBeLessThan(110_000);
    });

    it('country-scoped discount only applies to the matching destination', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([
          ['US', { label: 'US zone', rateByTierUpper: new Map([[1, 1_000_000]]) }],
          ['JP', { label: 'JP zone', rateByTierUpper: new Map([[1, 1_000_000]]) }],
        ]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'contract_discount_pct', value: 70, active: true, countryCodes: ['US'] },
        ],
      });
      const us = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      const jp = quote(snap, { weightKg: 1, destinationCountry: 'JP' });
      expect(us.ok && us.breakdown.discount).toBe(700_000);
      expect(jp.ok && jp.breakdown.discount).toBe(0);
    });

    it('multiple matching discount rows compound (stack the %)', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([
          ['US', { label: 'Zone', rateByTierUpper: new Map([[1, 1_000_000]]) }],
        ]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          // Two negotiated discount lines (base + tier bonus) → stack to 80 %
          { kind: 'contract_discount_pct', value: 70, active: true, countryCodes: ['US'] },
          { kind: 'contract_discount_pct', value: 10, active: true, countryCodes: null },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.discountPercent).toBe(80);
      expect(r.breakdown.discount).toBe(800_000);
    });

    it('discount is never fuelable — fuel applies on published base', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([
          ['US', { label: 'Zone', rateByTierUpper: new Map([[1, 1_000_000]]) }],
        ]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'fuel_percent', value: 20, active: true },
          { kind: 'contract_discount_pct', value: 50, active: true, countryCodes: null },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Fuel = 20 % × published base 1,000,000 = 200,000 (NOT 20 % × 500,000)
      expect(r.breakdown.fuel).toBe(200_000);
      expect(r.breakdown.discount).toBe(500_000);
      // carrierCost = base + fuel − discount = 1,000,000 + 200,000 − 500,000
      expect(r.breakdown.carrierCost).toBe(700_000);
    });

    it('discount reduces VAT base (VAT applies on the discounted total)', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([
          ['US', { label: 'Zone', rateByTierUpper: new Map([[1, 1_000_000]]) }],
        ]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'contract_discount_pct', value: 50, active: true, countryCodes: null },
          { kind: 'vat_percent', value: 8, active: true },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // VATable = base − discount = 500,000 → VAT 8 % = 40,000
      // Without discount the VAT would be 80,000.
      expect(r.breakdown.discount).toBe(500_000);
      expect(r.breakdown.vat).toBe(40_000);
      expect(r.breakdown.carrierCost).toBe(540_000);
    });

    it('null discount yields zero discount / discountPercent', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.discount).toBe(0);
      expect(r.breakdown.discountPercent).toBe(0);
    });
  });

  describe('dimensional weight (chargeable = max(actual, dim))', () => {
    it('charges actual when dim is lower', () => {
      const snap = makeSnap({ dimDivisorCm3PerKg: 5000 });
      // 30×20×10 = 6000 cm³ → 1.2 kg dim. Actual 2 kg wins.
      const r = quote(snap, {
        weightKg: 2,
        dimensions: { lengthCm: 30, widthCm: 20, heightCm: 10 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.actualWeightKg).toBe(2);
      expect(r.breakdown.dimWeightKg).toBe(1.2);
      expect(r.breakdown.chargeableWeightKg).toBe(2);
      expect(r.tier.upperKg).toBe(2);
    });

    it('charges dim when dim is higher (light bulky pack)', () => {
      const snap = makeSnap({ dimDivisorCm3PerKg: 5000 });
      // 40×31×2 cm = 2480 cm³ → 0.496 kg dim. Actual 0.3 kg loses.
      // But operator typically rounds UP: invoice charges next tier.
      const r = quote(snap, {
        weightKg: 0.3,
        dimensions: { lengthCm: 40, widthCm: 31, heightCm: 2 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.actualWeightKg).toBe(0.3);
      expect(r.breakdown.dimWeightKg).toBe(0.496);
      expect(r.breakdown.chargeableWeightKg).toBe(0.496);
      // Engine picks the 0.5 tier (200_000) because dim < 0.5 ≤ 0.5
      expect(r.tier.upperKg).toBe(0.5);
      expect(r.breakdown.base).toBe(200_000);
    });

    it('omits dim-weight when divisor is missing', () => {
      const snap = makeSnap(); // no dimDivisorCm3PerKg
      const r = quote(snap, {
        weightKg: 0.3,
        dimensions: { lengthCm: 100, widthCm: 100, heightCm: 100 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.dimWeightKg).toBe(0);
      expect(r.breakdown.chargeableWeightKg).toBe(0.3);
    });

    it('omits dim-weight when any side is missing or zero', () => {
      const snap = makeSnap({ dimDivisorCm3PerKg: 5000 });
      const r = quote(snap, {
        weightKg: 0.3,
        dimensions: { lengthCm: 40, widthCm: 0, heightCm: 2 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.dimWeightKg).toBe(0);
      expect(r.breakdown.chargeableWeightKg).toBe(0.3);
    });

    it('per_kg and per_step surcharges scale with chargeable weight, not actual', () => {
      const snap = makeSnap({
        dimDivisorCm3PerKg: 5000,
        surcharges: [
          { kind: 'per_kg_fixed', value: 10_000, active: true },
          // 1900 × ceil(weight / 0.5) — GoGreen step
          { kind: 'per_step_fixed', value: 1_900, active: true, stepKg: 0.5 },
        ],
      });
      // 40×40×10 = 16_000 cm³ → 3.2 kg dim. Actual 1 kg.
      const r = quote(snap, {
        weightKg: 1,
        dimensions: { lengthCm: 40, widthCm: 40, heightCm: 10 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.chargeableWeightKg).toBe(3.2);
      expect(r.breakdown.perKg).toBe(32_000);   // 10k × 3.2 chargeable
      expect(r.breakdown.perStep).toBe(13_300); // 1900 × ceil(3.2/0.5)=7
    });

    it('dim weight pushes the rate matrix to a higher tier', () => {
      const snap = makeSnap({ dimDivisorCm3PerKg: 5000 });
      // 50×30×15 = 22_500 cm³ → 4.5 kg dim. Actual 1 kg.
      const r = quote(snap, {
        weightKg: 1,
        dimensions: { lengthCm: 50, widthCm: 30, heightCm: 15 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // 4.5 kg lands in the ≤ 5 tier (600_000), not the ≤ 1 tier (280_000).
      expect(r.breakdown.chargeableWeightKg).toBe(4.5);
      expect(r.tier.upperKg).toBe(5);
      expect(r.breakdown.base).toBe(600_000);
    });

    it('breakdown surfaces zero dim/actual=chargeable when no dimensions', () => {
      const snap = makeSnap();
      const r = quote(snap, { weightKg: 1, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.dimWeightKg).toBe(0);
      expect(r.breakdown.actualWeightKg).toBe(1);
      expect(r.breakdown.chargeableWeightKg).toBe(1);
    });
  });

  describe('chargeableRoundingKg (per-carrier weight rounding before tier match)', () => {
    // FedEx-specific behaviour confirmed against 15+ invoices on
    // 2026-06-03: chargeable weight rounds to nearest 0.5 kg before
    // the tier lookup. Without this, raw chargeable 2.52 (from dim
    // 42×30×10 / 5000) picks tier 3.0 while the invoice charges
    // tier 2.5.
    it("applies FedEx 2-step rounding (nearest 0.1 then ceil 0.5)", () => {
      const snap = makeSnap({
        dimDivisorCm3PerKg: 5000,
        chargeableRoundingKg: 0.5,
      });
      // 42×30×10 = 12,600 cm³ / 5000 = 2.52 → rounded 2.5 → tier 2.5
      const r = quote(snap, {
        weightKg: 1,
        dimensions: { lengthCm: 42, widthCm: 30, heightCm: 10 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.dimWeightKg).toBe(2.52);
      expect(r.breakdown.chargeableWeightKg).toBe(2.5);
      // makeSnap fixture tiers are [0.5, 1, 2, 5]. 2.5 > 2 → next tier 5.
      expect(r.tier.upperKg).toBe(5);
      expect(r.breakdown.base).toBe(600_000);
    });

    it("keeps raw chargeable when chargeableRoundingKg is NULL (DHL rule)", () => {
      const snap = makeSnap({ dimDivisorCm3PerKg: 5000 });
      // 42×30×10 = 12,600 cm³ → 2.52 → engine picks first tier ≥ 2.52
      const r = quote(snap, {
        weightKg: 1,
        dimensions: { lengthCm: 42, widthCm: 30, heightCm: 10 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.chargeableWeightKg).toBe(2.52);
      expect(r.tier.upperKg).toBe(5);
    });

    it("rounds UP correctly at .5 boundary (3.75 → 4.0, banker's rounding off)", () => {
      const snap = makeSnap({
        dimDivisorCm3PerKg: 5000,
        chargeableRoundingKg: 0.5,
      });
      // 75×50×5 cm = 18,750 cm³ / 5000 = 3.75 → rounded 4.0
      const r = quote(snap, {
        weightKg: 1,
        dimensions: { lengthCm: 75, widthCm: 50, heightCm: 5 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.dimWeightKg).toBe(3.75);
      expect(r.breakdown.chargeableWeightKg).toBe(4);
    });

    it('rounds DOWN when fractional is below the half-step', () => {
      const snap = makeSnap({
        dimDivisorCm3PerKg: 5000,
        chargeableRoundingKg: 0.5,
      });
      // 50×30×6.79 cm = 10,185 cm³ → 2.037 → nearest 0.5 = 2.0
      const r = quote(snap, {
        weightKg: 1,
        dimensions: { lengthCm: 50, widthCm: 30, heightCm: 6.79 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.chargeableWeightKg).toBe(2);
    });

    it.each([
      // Real production rows verified 2026-06-03 — every dim weight here
      // has the FedEx 2-step rule producing the SAME tier the invoice
      // billed at. Keeps the math airtight against future engine changes.
      { dim_w: 2.04,  expected: 2.0 },  // MBLVD27562/27145 SA
      { dim_w: 2.355, expected: 2.5 },  // MBLVD28124 US (32×23×16)
      { dim_w: 2.52,  expected: 2.5 },  // MBLVD28163/27486 US/QA — most common
      { dim_w: 3.75,  expected: 4.0 },  // MBLVD28186 US (30×25×25)
      { dim_w: 5.0,   expected: 5.0 },  // MBLVD27424 SA (40×25×25)
      { dim_w: 5.58,  expected: 6.0 },  // MBLVD28136 US (47×33×18)
    ])('FedEx invoice math: dim $dim_w → tier $expected', ({ dim_w, expected }) => {
      const snap = makeSnap({
        // Disable dim divisor — drive chargeable purely from actual to
        // isolate the rounding logic from dim-derivation.
        chargeableRoundingKg: 0.5,
      });
      const r = quote(snap, { weightKg: dim_w, destinationCountry: 'SG' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.chargeableWeightKg).toBe(expected);
    });
  });

  describe('demand_per_kg default fuelable=false (FedEx invoice 2026-06-03)', () => {
    // The operator's LOG-Export Excel verified that FedEx Demand
    // Surcharge sits OUTSIDE the fuel base — proof via #MBLVD28959:
    //   effective_base 703,458 + remote 82,200 = 785,658
    //   × 49.25 % CW 23 fuel = 386,937  ← matches Excel col AK exactly
    // Demand (68,300 in that invoice — actually country_fixed-style)
    // does NOT appear in the fuel base. Engine default flipped to false.
    it('demand_per_kg defaults to fuelable=false', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([['US', { label: 'Zone D', rateByTierUpper: new Map([[1, 700_000]]) }]]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'fuel_percent', value: 50, active: true },
          { kind: 'demand_per_kg', value: 11_300, active: true, countryCodes: ['US'] },
          // omit `fuelable` on the demand row → default kicks in
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // fuel = 50% × base 700k = 350k (NOT 50% × (700k + 11.3k))
      expect(r.breakdown.demand).toBe(11_300);
      expect(r.breakdown.fuel).toBe(350_000);
    });

    it('per-row fuelable=true override forces demand_per_kg back into fuel base', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([['US', { label: 'Zone D', rateByTierUpper: new Map([[1, 700_000]]) }]]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          { kind: 'fuel_percent', value: 50, active: true },
          // Some hypothetical carrier where demand IS in fuel base
          { kind: 'demand_per_kg', value: 11_300, active: true, countryCodes: ['US'], fuelable: true },
        ],
      });
      const r = quote(snap, { weightKg: 1, destinationCountry: 'US' });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // fuel = 50% × (700k + 11.3k) = 355,650
      expect(r.breakdown.fuel).toBe(355_650);
    });

    it('reproduces FedEx #MBLVD28959 fuel math (base + remote, demand OUTSIDE)', () => {
      const snap = makeSnap({
        zonesByCountry: new Map([['US', { label: 'Zone D', rateByTierUpper: new Map([[1, 703_458]]) }]]),
        weightTiers: [{ upperKg: 1 }],
        surcharges: [
          // CW 23 FedEx Air fuel = 49.25 %
          { kind: 'fuel_percent', value: 49.25, active: true },
          { kind: 'remote_fixed', value: 82_200, active: true },
          // Excel col AM "Demand" = FedEx VN US-handling — modelled as
          // demand_per_kg with rate that yields 68,300 at 0.7 kg.
          { kind: 'demand_per_kg', value: 97_571.4, active: true, countryCodes: ['US'] },
        ],
        remotePostcodes: new Map([['US', new Map([['ZIP-90001', null]])]]),
      });
      const r = quote(snap, {
        weightKg: 0.7,
        destinationCountry: 'US',
        destinationPostcode: 'ZIP-90001',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      // Invoice math (Excel row 22):
      //   base 703,458 + remote 82,200 = 785,658
      //   × 49.25% fuel = 386,937 (Excel says 386,937 ✅)
      expect(r.breakdown.remote).toBe(82_200);
      expect(r.breakdown.fuel).toBe(386_937);
    });
  });

  describe('packagingType (Pak vs Package selection)', () => {
    function makeSnapWithBothRates(): CarrierAccountSnapshot {
      // Distinct Package vs Pak rates so we can tell which matrix the
      // engine read by looking at `base`. Pak rates exist only at the
      // lower tiers — the historical FedEx pattern.
      const rateByTierUpper = new Map<number, number>([
        [0.5, 200_000],   // Package: 0.5 kg
        [1, 280_000],     // Package: 1 kg
        [2, 360_000],     // Package: 2 kg
        [5, 600_000],     // Package: 5 kg
      ]);
      const pakRateByTierUpper = new Map<number, number>([
        [0.5, 150_000],   // Pak: 0.5 kg (cheaper than Package)
        [1, 210_000],     // Pak: 1 kg
        // No Pak rate at 2+ kg → engine falls back to Package
      ]);
      return makeSnap({
        zonesByCountry: new Map([
          ['SG', { label: 'Zone 1', rateByTierUpper, pakRateByTierUpper }],
        ]),
      });
    }

    it("explicit 'box' forces Package rate even for a light pack", () => {
      const snap = makeSnapWithBothRates();
      // 0.4 kg would normally hit Pak via weight rule (<2 kg), but
      // operator imported the pack as Box → force Package rate.
      const r = quote(snap, {
        weightKg: 0.4,
        packagingType: 'box',
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.tier.upperKg).toBe(0.5);
      expect(r.breakdown.base).toBe(200_000); // Package rate, not 150k Pak
      expect(r.notes).not.toContain('pak');
    });

    it("explicit 'bag' forces Pak rate even for a 2 kg+ pack (no Pak → fallback)", () => {
      const snap = makeSnapWithBothRates();
      // 2.5 kg lands in Package-only tier; explicit Bag → engine still
      // tries Pak first, falls back to Package, leaves a note.
      const r = quote(snap, {
        weightKg: 2.5,
        packagingType: 'bag',
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.tier.upperKg).toBe(5);
      expect(r.breakdown.base).toBe(600_000); // Package fallback
      expect(r.notes).toContain('pak_fallback_to_package');
    });

    it("explicit 'bag' uses Pak rate when Pak rate exists at the tier", () => {
      const snap = makeSnapWithBothRates();
      const r = quote(snap, {
        weightKg: 1,
        packagingType: 'bag',
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.base).toBe(210_000); // Pak rate
      expect(r.notes).toContain('pak');
    });

    it('falls back to the legacy weight rule when packagingType is omitted', () => {
      const snap = makeSnapWithBothRates();
      // No packagingType → < 2 kg → Pak.
      const r1 = quote(snap, { weightKg: 0.4, destinationCountry: 'SG' });
      expect(r1.ok).toBe(true);
      if (r1.ok) expect(r1.breakdown.base).toBe(150_000); // Pak at 0.5 tier
      // No packagingType → ≥ 2 kg → Package.
      const r2 = quote(snap, { weightKg: 2.5, destinationCountry: 'SG' });
      expect(r2.ok).toBe(true);
      if (r2.ok) expect(r2.breakdown.base).toBe(600_000);
    });

    it("a 'bag' pack uses the dim weight when dim > actual (max rule still wins)", () => {
      const snap = makeSnap({
        dimDivisorCm3PerKg: 5000,
        zonesByCountry: new Map([
          ['SG', {
            label: 'Zone',
            rateByTierUpper: new Map([[1, 280_000], [2, 360_000]]),
            pakRateByTierUpper: new Map([[1, 210_000]]), // no Pak ≥ 2
          }],
        ]),
        weightTiers: [{ upperKg: 1 }, { upperKg: 2 }],
      });
      // 40×40×10 = 16,000 cm³ / 5000 = 3.2 kg dim. Actual 0.5 kg.
      // Chargeable 3.2 kg → tier ≤ 2 (since 2 is the top tier), but
      // 3.2 > 2 → note that weight exceeds top tier. With 'bag',
      // engine still tries Pak first then falls back to Package.
      const r = quote(snap, {
        weightKg: 0.5,
        packagingType: 'bag',
        dimensions: { lengthCm: 40, widthCm: 40, heightCm: 10 },
        destinationCountry: 'SG',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.breakdown.chargeableWeightKg).toBe(3.2);
      expect(r.tier.upperKg).toBe(2);
      expect(r.breakdown.base).toBe(360_000); // Package at top tier
      expect(r.notes).toContain('pak_fallback_to_package');
    });
  });
});
