import { describe, it, expect } from 'vitest';
import { computeCheckoutRates, locCarrierCheckout, CHECKOUT_CARRIER_KEYS } from './checkout-rates';
import type { CarrierAccountSnapshot } from './engine/quote';

function snap(label: string, name: string): CarrierAccountSnapshot {
  return {
    id: 'a', name, costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26_000,
    weightTiers: [{ upperKg: 1 }, { upperKg: 5 }],
    zonesByCountry: new Map([['US', { label, rateByTierUpper: new Map([[1, 1_300_000], [5, 2_600_000]]) }]]),
    surcharges: [{ kind: 'markup_percent', value: 15, active: true }],
    remotePostcodes: new Map(),
  };
}

describe('computeCheckoutRates', () => {
  it('quote mỗi carrier phục vụ đích → rate Shopify (total_price cents)', () => {
    const rates = computeCheckoutRates({
      country: 'US', postalCode: '10560', weightKg: 0.8,
      carriers: [
        { serviceCode: 'fedex', serviceName: 'FedEx IP', snapshot: snap('Zone US', 'FedEx') },
        { serviceCode: 'dhl', serviceName: 'DHL Express', snapshot: snap('Zone US', 'DHL') },
      ],
    });
    expect(rates).toHaveLength(2);
    expect(rates[0].service_code).toBe('fedex');
    expect(rates[0].currency).toBe('USD');
    // finalDisplay = (1.3M base ×1.15 markup)/26000 ≈ 57.5 USD → 5750 cents
    expect(Number(rates[0].total_price)).toBeGreaterThan(5000);
    expect(rates[0].total_price).toMatch(/^\d+$/);
  });

  it('carrier không phục vụ đích (no zone) → bỏ qua', () => {
    const s = snap('Zone US', 'FedEx');
    const rates = computeCheckoutRates({ country: 'ZZ', weightKg: 1, carriers: [{ serviceCode: 'fedex', serviceName: 'FedEx', snapshot: s }] });
    expect(rates).toHaveLength(0);
  });

  it('giỏ không cân (0) → tối thiểu 0,5kg, vẫn ra rate', () => {
    const rates = computeCheckoutRates({ country: 'US', weightKg: 0, carriers: [{ serviceCode: 'f', serviceName: 'F', snapshot: snap('Zone US', 'F') }] });
    expect(rates).toHaveLength(1);
  });
});

describe('locCarrierCheckout', () => {
  const acc = (key: string | null, enabled = true) => ({ key, enabled, id: key ?? 'x' });

  it('chỉ giữ FedEx + DHL — Aramex/UPS/SF là line nội bộ, không chào khách', () => {
    const out = locCarrierCheckout([acc('fedex'), acc('aramex'), acc('ups'), acc('sf-express'), acc('dhl')]);
    expect(out.map((a) => a.key)).toEqual(['fedex', 'dhl']);
  });

  it('bỏ account đã tắt dù đúng hãng', () => {
    expect(locCarrierCheckout([acc('fedex', false), acc('dhl')]).map((a) => a.key)).toEqual(['dhl']);
  });

  it('bỏ account không có carrier key', () => {
    expect(locCarrierCheckout([acc(null), acc('fedex')]).map((a) => a.key)).toEqual(['fedex']);
  });

  it('danh sách trắng không được lỡ tay thêm hãng nội bộ', () => {
    expect([...CHECKOUT_CARRIER_KEYS].sort()).toEqual(['dhl', 'fedex']);
  });
});

describe('computeCheckoutRates — phụ phí theo-ca', () => {
  it('KHÔNG cộng addon when_billed vào giá khách (UPS sai địa chỉ / pallet Aramex)', () => {
    const s = snap('Zone US', 'Hãng có phí theo ca');
    s.surcharges = [
      { kind: 'markup_percent', value: 15, active: true },
      { kind: 'addon_fixed', value: 1_973_060, active: true, applyMode: 'when_billed' },
    ];
    const rates = computeCheckoutRates({
      country: 'US', postalCode: '10560', weightKg: 0.8,
      carriers: [{ serviceCode: 'ups', serviceName: 'UPS', snapshot: s }],
    });
    // 1.973.060đ ≈ 75 USD; nếu bị cộng thì giá vọt lên trên 100 USD.
    expect(Number(rates[0].total_price)).toBeLessThan(10_000);
  });

  it('VẪN cộng addon always (ký nhận FedEx/DHL) — đó là phí chắc chắn có', () => {
    const s = snap('Zone US', 'Hãng có ký nhận');
    s.surcharges = [
      { kind: 'markup_percent', value: 15, active: true },
      { kind: 'addon_fixed', value: 92_700, active: true, applyMode: 'always' },
    ];
    const khong = computeCheckoutRates({
      country: 'US', postalCode: '10560', weightKg: 0.8,
      carriers: [{ serviceCode: 'fedex', serviceName: 'FedEx', snapshot: snap('Zone US', 'FedEx') }],
    });
    const co = computeCheckoutRates({
      country: 'US', postalCode: '10560', weightKg: 0.8,
      carriers: [{ serviceCode: 'fedex', serviceName: 'FedEx', snapshot: s }],
    });
    expect(Number(co[0].total_price)).toBeGreaterThan(Number(khong[0].total_price));
  });
});
