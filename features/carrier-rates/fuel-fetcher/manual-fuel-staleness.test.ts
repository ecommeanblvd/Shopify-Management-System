import { describe, it, expect } from 'vitest';
import { findStaleManualFuel, type ManualFuelRow } from './manual-fuel-staleness';

const NOW = new Date('2026-07-06T00:00:00.000Z');

function row(overrides: Partial<ManualFuelRow>): ManualFuelRow {
  return {
    accountId: 'acc-1',
    accountName: 'Test Account',
    carrierKey: 'some-manual-carrier',
    fuelPercent: 27,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('findStaleManualFuel', () => {
  it('ignores fedex accounts even when stale', () => {
    const rows = [
      row({ carrierKey: 'fedex', fuelPercent: null, updatedAt: null }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('ignores dhl accounts even when stale', () => {
    const rows = [
      row({ carrierKey: 'dhl', fuelPercent: 0, updatedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('ignores ups accounts (auto-fetched from assets.ups.com) even when stale', () => {
    const rows = [
      row({ carrierKey: 'ups', fuelPercent: 0, updatedAt: new Date('2026-01-01T00:00:00.000Z') }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('flags manual-carrier fuel=0 as unset', () => {
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 0 })];
    const result = findStaleManualFuel(rows, NOW, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('unset');
    expect(result[0].daysSince).toBeNull();
  });

  it('flags manual-carrier fuel=27 updated 10 days ago as stale with daysSince 10 (staleDays 7)', () => {
    const tenDaysAgo = new Date('2026-06-26T00:00:00.000Z');
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 27, updatedAt: tenDaysAgo })];
    const result = findStaleManualFuel(rows, NOW, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('stale');
    expect(result[0].daysSince).toBe(10);
  });

  it('does not flag manual-carrier fuel=27 updated today', () => {
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 27, updatedAt: NOW })];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('ignores fuelPercent null (all-in carrier, e.g. Aramex — no fuel_percent row at all)', () => {
    const rows = [
      row({ carrierKey: 'aramex', fuelPercent: null, updatedAt: null }),
    ];
    expect(findStaleManualFuel(rows, NOW, 7)).toEqual([]);
  });

  it('flags manual-carrier fuel=0 (placeholder row present but value 0) as unset', () => {
    const rows = [row({ carrierKey: 'some-manual-carrier', fuelPercent: 0, updatedAt: NOW })];
    const result = findStaleManualFuel(rows, NOW, 7);
    expect(result).toHaveLength(1);
    expect(result[0].reason).toBe('unset');
    expect(result[0].daysSince).toBeNull();
  });
});
