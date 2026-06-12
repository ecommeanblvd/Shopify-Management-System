import { describe, it, expect } from 'vitest';
import { flattenShippingMatrix, buildRateMatrix } from './shipping-matrix-view';
import type { MarketShipping } from '../types';

const ship = (zones: MarketShipping['zones']): MarketShipping => ({ zones });

describe('flattenShippingMatrix', () => {
  it('null/rỗng → []', () => {
    expect(flattenShippingMatrix(null)).toEqual([]);
    expect(flattenShippingMatrix(ship({}))).toEqual([]);
  });
  it('rate sắp theo cận trên kg', () => {
    const z = flattenShippingMatrix(ship({
      'Zone A': { countries: ['US'], rates: {
        'FedEx IP (1–2 kg)': { type: 'flat', price: 80, currency: 'USD' },
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 54.5, currency: 'USD' },
        'FedEx IP (0.5–1 kg)': { type: 'flat', price: 64, currency: 'USD' },
      } },
    }));
    expect(z).toHaveLength(1);
    expect(z[0].zoneName).toBe('Zone A');
    expect(z[0].countries).toEqual(['US']);
    expect(z[0].rates.map((r) => r.price)).toEqual([54.5, 64, 80]);
  });
  it('label không khớp regex đẩy cuối', () => {
    const z = flattenShippingMatrix(ship({
      'Z': { countries: [], rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 10, currency: 'USD' },
        'Đồng giá': { type: 'flat', price: 99, currency: 'USD' },
      } },
    }));
    expect(z[0].rates.map((r) => r.label)).toEqual(['FedEx IP (0–0.5 kg)', 'Đồng giá']);
  });
  it('giữ thứ tự zone', () => {
    const z = flattenShippingMatrix(ship({
      'B': { countries: [], rates: {} }, 'A': { countries: [], rates: {} },
    }));
    expect(z.map((x) => x.zoneName)).toEqual(['B', 'A']);
  });
});

describe('buildRateMatrix', () => {
  it('pivot carrier × bậc cân', () => {
    const [zone] = flattenShippingMatrix({ zones: {
      'Z': { countries: ['SA'], rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 51, currency: 'USD' },
        'DHL Express (0–0.5 kg)': { type: 'flat', price: 46.29, currency: 'USD' },
        'FedEx IP (0.5–1 kg)': { type: 'flat', price: 60.5, currency: 'USD' },
        'DHL Express (0.5–1 kg)': { type: 'flat', price: 46.38, currency: 'USD' },
      } },
    } });
    const m = buildRateMatrix(zone);
    expect(m.carriers).toEqual(['FedEx IP', 'DHL Express']);
    expect(m.rows.map((r) => r.bracket)).toEqual(['0–0.5 kg', '0.5–1 kg']);
    expect(m.rows[0].cells).toEqual([
      { price: 51, currency: 'USD' },
      { price: 46.29, currency: 'USD' },
    ]);
  });
  it('carrier thiếu giá ở 1 bậc → cell null', () => {
    const [zone] = flattenShippingMatrix({ zones: {
      'Z': { countries: [], rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat', price: 51, currency: 'USD' },
        'DHL Express (0.5–1 kg)': { type: 'flat', price: 46, currency: 'USD' },
      } },
    } });
    const m = buildRateMatrix(zone);
    expect(m.carriers).toEqual(['FedEx IP', 'DHL Express']);
    expect(m.rows).toHaveLength(2);
    // bracket 0–0.5: FedEx 51, DHL null ; bracket 0.5–1: FedEx null, DHL 46
    expect(m.rows.find((r) => r.bracket === '0–0.5 kg')!.cells).toEqual([{ price: 51, currency: 'USD' }, null]);
    expect(m.rows.find((r) => r.bracket === '0.5–1 kg')!.cells).toEqual([null, { price: 46, currency: 'USD' }]);
  });
  it('label không có "(... )" → carrier = label, bracket = "—"', () => {
    const [zone] = flattenShippingMatrix({ zones: {
      'Z': { countries: [], rates: { 'Đồng giá': { type: 'flat', price: 99, currency: 'USD' } } },
    } });
    const m = buildRateMatrix(zone);
    expect(m.carriers).toEqual(['Đồng giá']);
    expect(m.rows[0].bracket).toBe('—');
  });
});
