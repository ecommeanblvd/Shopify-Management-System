import { describe, it, expect } from 'vitest';
import { flattenShippingMatrix } from './shipping-matrix-view';
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
