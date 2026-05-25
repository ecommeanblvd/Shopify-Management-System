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
      expect(r.breakdown.subtotalBeforeMarkup).toBe(514_000); // 280 + 84 + 150
      expect(r.breakdown.markup).toBe(61_680); // 12% of 514_000
      expect(r.breakdown.finalCost).toBe(575_680);
      expect(r.breakdown.finalDisplay).toBeCloseTo(22.14, 2);
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
