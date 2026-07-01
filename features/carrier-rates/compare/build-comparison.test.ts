import { describe, expect, it } from 'vitest';
import { buildComparison, carrierCostToVnd } from './build-comparison';
import type { CarrierAccountSnapshot, ZoneSnap } from '../engine/quote';

const AS_OF = new Date('2026-07-01T00:00:00Z');

function zone(rate: number): ZoneSnap {
  return { label: 'Z', rateByTierUpper: new Map([[1, rate]]), pakRateByTierUpper: new Map() };
}

/** Snapshot cost=VND (DHL/FedEx kiểu VN): carrierCost đã là VND. */
function vndSnap(id: string, name: string, countries: Record<string, number>): CarrierAccountSnapshot {
  const zonesByCountry = new Map<string, ZoneSnap>();
  for (const [c, r] of Object.entries(countries)) zonesByCountry.set(c, zone(r));
  return {
    id, name, costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26000,
    dimDivisorCm3PerKg: null, chargeableRoundingMode: null, totalsRoundingMode: null,
    chargeableRoundingKg: null, zonesByCountry, weightTiers: [{ upperKg: 1 }],
    surcharges: [], remotePostcodes: new Map(),
  };
}

describe('carrierCostToVnd', () => {
  it('cost=VND → dùng carrierCost (đã VND)', () => {
    expect(carrierCostToVnd({ costCurrency: 'VND', displayCurrency: 'USD' }, { carrierCost: 100_000, carrierCostDisplay: 3.85 })).toBe(100_000);
  });
  it('cost=USD, display=VND → dùng carrierCostDisplay (Aramex)', () => {
    expect(carrierCostToVnd({ costCurrency: 'USD', displayCurrency: 'VND' }, { carrierCost: 10, carrierCostDisplay: 260_000 })).toBe(260_000);
  });
  it('không bên nào VND → fallback carrierCost × 26000', () => {
    expect(carrierCostToVnd({ costCurrency: 'USD', displayCurrency: 'USD' }, { carrierCost: 10, carrierCostDisplay: 10 })).toBe(260_000);
  });
});

describe('buildComparison', () => {
  it('xếp rẻ→đắt, cờ cheapest + %Δ so với rẻ nhất', () => {
    const a = vndSnap('a', 'DHL', { US: 100_000 });
    const b = vndSnap('b', 'FedEx', { US: 120_000 });
    const cube = buildComparison([a, b], ['US'], [1], AS_OF);
    const rates = cube.cells.US[1].rates;
    expect(rates.map((r) => r.carrierName)).toEqual(['DHL', 'FedEx']);
    expect(rates[0]).toMatchObject({ vnd: 100_000, cheapest: true, pctOverCheapest: 0 });
    expect(rates[1]).toMatchObject({ vnd: 120_000, cheapest: false, pctOverCheapest: 20 });
  });

  it('carrier không phủ nước → không nằm trong ô', () => {
    const a = vndSnap('a', 'DHL', { US: 100_000 });
    const b = vndSnap('b', 'FedEx', { JP: 90_000 }); // không có US
    const cube = buildComparison([a, b], ['US'], [1], AS_OF);
    expect(cube.cells.US[1].rates.map((r) => r.carrierName)).toEqual(['DHL']);
  });

  it('không carrier nào phủ nước → ô rỗng', () => {
    const a = vndSnap('a', 'DHL', { US: 100_000 });
    const cube = buildComparison([a], ['SA'], [1], AS_OF);
    expect(cube.cells.SA[1].rates).toEqual([]);
  });

  it('giữ nguyên trục nước/cân đã yêu cầu', () => {
    const a = vndSnap('a', 'DHL', { US: 100_000 });
    const cube = buildComparison([a], ['US', 'JP'], [1], AS_OF);
    expect(cube.countries).toEqual(['US', 'JP']);
    expect(cube.weights).toEqual([1]);
  });
});
