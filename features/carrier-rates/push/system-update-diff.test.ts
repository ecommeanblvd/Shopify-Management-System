import { describe, it, expect } from 'vitest';
import { buildSystemUpdatePlan, isUpdateOnly } from './system-update-diff';
import type { NormalizedShipping } from '@/features/settings-sync/domain/shipping';
import { bandKeyOf } from '@/features/settings-sync/domain/shipping';

// Store: zone NA2 (US) with two Standard shipping bands (upper 0.5 @ 54.5, upper 1 @ 66).
function storeNA2(): NormalizedShipping {
  return {
    tree: { zones: { NA2: { countries: ['US'], rates: { 'Standard shipping': { type: 'flat', price: 66, currency: 'USD' } } } } },
    shopifyIds: { profileId: 'gid://p/1', locationGroupId: 'gid://lg/1', zoneIdByName: { NA2: 'gid://z/NA2' }, rateIdByZoneAndName: {} },
    bandRates: {
      [bandKeyOf('NA2', 'Standard shipping', '0.5')]: { id: 'gid://md/A', price: 54.5, currency: 'USD' },
      [bandKeyOf('NA2', 'Standard shipping', '1')]: { id: 'gid://md/B', price: 66, currency: 'USD' },
    },
  };
}

const sysNA2 = (p05: number, p1: number) => ({
  zones: { NA2: { countries: ['US'], rates: {
    'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: p05, currency: 'USD' },
    'FedEx IP (0.5–1 kg)': { type: 'flat' as const, price: p1, currency: 'USD' },
  } } },
});

describe('buildSystemUpdatePlan', () => {
  it('price-only change → only updates, no create/delete', () => {
    const plan = buildSystemUpdatePlan(storeNA2(), sysNA2(60, 70));
    expect(plan.zonesToCreate).toHaveLength(0);
    expect(plan.zonesToDelete).toHaveLength(0);
    expect(plan.zoneUpdates).toEqual([{ zoneId: 'gid://z/NA2', updates: [
      { id: 'gid://md/A', price: 60, currency: 'USD' },
      { id: 'gid://md/B', price: 70, currency: 'USD' },
    ], creates: [] }]);
    expect(isUpdateOnly(plan)).toBe(true);
  });

  it('identical prices → no-op', () => {
    const plan = buildSystemUpdatePlan(storeNA2(), sysNA2(54.5, 66));
    expect(plan.zoneUpdates).toHaveLength(0);
    expect(plan.counts.updates).toBe(0);
    expect(isUpdateOnly(plan)).toBe(true);
  });

  it('new zone → zonesToCreate, not update path', () => {
    const sys = { zones: { ...sysNA2(60, 70).zones, EU1: { countries: ['DE'], rates: { 'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: 40, currency: 'USD' } } } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.zonesToCreate.map((z) => z.name)).toEqual(['EU1']);
    expect(isUpdateOnly(plan)).toBe(false);
  });

  it('band added in system (missing on store) → methodDefinitionsToCreate in zone', () => {
    const sys = { zones: { NA2: { countries: ['US'], rates: {
      ...sysNA2(60, 70).zones.NA2.rates,
      'FedEx IP (1–2 kg)': { type: 'flat' as const, price: 80, currency: 'USD' },
    } } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.zoneUpdates[0].creates).toEqual([{ name: 'Standard shipping', price: 80, currency: 'USD', upperKg: 2 }]);
    expect(isUpdateOnly(plan)).toBe(true); // create within existing zone stays on fast path
  });

  it('band on store not in system → rateDeletes', () => {
    const sys = { zones: { NA2: { countries: ['US'], rates: {
      'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: 60, currency: 'USD' },
    } } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.rateDeletes).toContain('gid://md/B');
    expect(isUpdateOnly(plan)).toBe(true);
  });

  it('country drift → zone deleted + recreated', () => {
    const sys = { zones: { NA2: { countries: ['US', 'CA'], rates: sysNA2(60, 70).zones.NA2.rates } } };
    const plan = buildSystemUpdatePlan(storeNA2(), sys);
    expect(plan.zonesToDelete).toEqual(['gid://z/NA2']);
    expect(plan.zonesToCreate.map((z) => z.name)).toEqual(['NA2']);
    expect(isUpdateOnly(plan)).toBe(false);
  });
});
