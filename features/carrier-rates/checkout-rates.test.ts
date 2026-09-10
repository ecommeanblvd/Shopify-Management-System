import { describe, it, expect } from 'vitest';
import { computeCheckoutRates, locCarrierCheckout, CHECKOUT_CARRIER_KEYS } from './checkout-rates';
import { loTenHang, TEN_MUC } from './hai-muc-giao';
import type { CarrierAccountSnapshot } from './engine/quote';

function snap(label: string, name: string, country = 'US', base = 1_300_000): CarrierAccountSnapshot {
  return {
    id: 'a', name, costCurrency: 'VND', displayCurrency: 'USD', fxCostPerDisplay: 26_000,
    weightTiers: [{ upperKg: 1 }, { upperKg: 5 }],
    zonesByCountry: new Map([[country, { label, rateByTierUpper: new Map([[1, base], [5, base * 2]]) }]]),
    surcharges: [{ kind: 'markup_percent', value: 15, active: true }],
    remotePostcodes: new Map(),
  };
}

describe('computeCheckoutRates — hai mức Standard / Express (D-071)', () => {
  it('một hãng phục vụ đích → ĐÚNG 2 rate Standard < Express, cents dạng chuỗi, USD', () => {
    const rates = computeCheckoutRates({
      country: 'US', postalCode: '10560', weightKg: 0.8,
      carriers: [{ carrierKey: 'fedex', snapshot: snap('Zone US', 'FedEx') }],
    });
    expect(rates.map((r) => r.service_name)).toEqual([TEN_MUC.standard, TEN_MUC.express]);
    expect(rates.map((r) => r.service_code)).toEqual(['standard', 'express']);
    expect(rates.every((r) => r.currency === 'USD')).toBe(true);
    // finalDisplay = (1.3M base ×1.15 markup)/26000 ≈ 57.5 USD → 5750 cents
    expect(Number(rates[0].total_price)).toBeGreaterThan(5000);
    expect(rates[0].total_price).toMatch(/^\d+$/);
    expect(Number(rates[0].total_price)).toBeLessThan(Number(rates[1].total_price));
  });

  it('có cả FedEx và DHL → vẫn chỉ 2 rate, giá gốc là FedEx (ưu tiên), dù DHL rẻ hơn', () => {
    const rates = computeCheckoutRates({
      country: 'US', weightKg: 0.8,
      carriers: [
        { carrierKey: 'dhl', snapshot: snap('Zone US', 'DHL', 'US', 1_000_000) },   // rẻ hơn
        { carrierKey: 'fedex', snapshot: snap('Zone US', 'FedEx', 'US', 1_300_000) },
      ],
    });
    expect(rates).toHaveLength(2);
    // FedEx: 1.3M×1.15/26000 = 57.5 → 5750; nếu lấy DHL sẽ là 4423.
    expect(rates[0].total_price).toBe('5750');
  });

  it('FedEx không có zone tới nước đó → rơi về DHL làm giá gốc (RW1–RW4 chỉ DHL)', () => {
    const rates = computeCheckoutRates({
      country: 'MM', weightKg: 1,
      carriers: [
        { carrierKey: 'fedex', snapshot: snap('Zone US', 'FedEx', 'US') },
        { carrierKey: 'dhl', snapshot: snap('Zone MM', 'DHL', 'MM', 1_000_000) },
      ],
    });
    expect(rates).toHaveLength(2);
    expect(rates[0].total_price).toBe('4423');
  });

  it('không hãng nào phục vụ đích → []', () => {
    const rates = computeCheckoutRates({ country: 'ZZ', weightKg: 1, carriers: [{ carrierKey: 'fedex', snapshot: snap('Zone US', 'FedEx') }] });
    expect(rates).toHaveLength(0);
  });

  it('giỏ không cân (0) → tối thiểu 0,5kg, vẫn ra 2 rate', () => {
    const rates = computeCheckoutRates({ country: 'US', weightKg: 0, carriers: [{ carrierKey: 'fedex', snapshot: snap('Zone US', 'F') }] });
    expect(rates).toHaveLength(2);
  });

  it('KHÔNG lộ tên hãng ở tên rate hay mô tả, kể cả khi tên account có chữ FedEx', () => {
    const rates = computeCheckoutRates({ country: 'US', weightKg: 0.8, carriers: [{ carrierKey: 'fedex', snapshot: snap('Zone US', 'FedEx Vietnam — IP 2026') }] });
    for (const r of rates) {
      expect(loTenHang(r.service_name)).toBe(false);
      expect(loTenHang(r.description ?? '')).toBe(false);
      expect(loTenHang(r.service_code)).toBe(false);
    }
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

  it('danh sách trắng không được lỡ tay thêm hãng nội bộ; FedEx đứng trước DHL (ưu tiên làm giá gốc)', () => {
    expect([...CHECKOUT_CARRIER_KEYS]).toEqual(['fedex', 'dhl']);
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
      carriers: [{ carrierKey: 'fedex', snapshot: s }],
    });
    // 1.973.060đ ≈ 75 USD; nếu bị cộng thì giá Standard vọt lên trên 100 USD.
    expect(Number(rates[0].total_price)).toBeLessThan(10_000);
  });

  it('VẪN cộng addon always (ký nhận FedEx/DHL) — đó là phí chắc chắn có', () => {
    const s = snap('Zone US', 'Hãng có ký nhận');
    s.surcharges = [
      { kind: 'markup_percent', value: 15, active: true },
      { kind: 'addon_fixed', value: 92_700, active: true, applyMode: 'always' },
    ];
    const khong = computeCheckoutRates({ country: 'US', postalCode: '10560', weightKg: 0.8, carriers: [{ carrierKey: 'fedex', snapshot: snap('Zone US', 'FedEx') }] });
    const co = computeCheckoutRates({ country: 'US', postalCode: '10560', weightKg: 0.8, carriers: [{ carrierKey: 'fedex', snapshot: s }] });
    expect(Number(co[0].total_price)).toBeGreaterThan(Number(khong[0].total_price));
  });
});
