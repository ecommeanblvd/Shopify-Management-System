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
        remotePostcodes: new Map([['TH', new Set(['REMOTE-1'])]]),
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
