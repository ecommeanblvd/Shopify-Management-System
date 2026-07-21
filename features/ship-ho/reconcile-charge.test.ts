import { describe, it, expect } from 'vitest';
import { reconciledBrandCharge } from './reconcile-charge';

describe('reconciledBrandCharge', () => {
  const base = {
    baseVnd: 1_000_000, markupPercent: 20,
    transportSurchargesVnd: 200_000, customsSurchargesVnd: 0,
    fuelPercent: 38.25, vatPercent: 8, serviceLabel: 'Express Delivery',
  };

  it('cước cơ bản = base × (1+markup)', () => {
    const r = reconciledBrandCharge(base);
    expect(r.markedBaseVnd).toBe(1_200_000); // 1.000.000 × 1.2
  });

  it('fuel áp trên cước cơ bản + phụ phí vận chuyển (KHÔNG gồm customs)', () => {
    const r = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300 });
    // fuel = 38.25% × (1.200.000 + 200.000) = 535.500 — customs 68.300 KHÔNG vào fuel base.
    expect(r.fuelVnd).toBe(535_500);
  });

  it('VAT áp bước cuối trên TẤT CẢ gồm customs + fuel + phí xử lý', () => {
    const r = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300 });
    // vatBase = 1.200.000 + 200.000 + 68.300 + 535.500 + 50.000 = 2.053.800
    // vat = 8% × 2.053.800 = 164.304
    expect(r.vatVnd).toBe(164_304);
    expect(r.chargedVnd).toBe(2_053_800 + 164_304);
  });

  it('tổng lines == chargedVnd', () => {
    const r = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300 });
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });

  it('phụ phí = 0 → không có dòng phụ phí, chỉ base+fuel+xử lý+VAT', () => {
    const r = reconciledBrandCharge({ ...base, transportSurchargesVnd: 0, customsSurchargesVnd: 0 });
    expect(r.lines.map((l) => l.label)).toEqual([
      'Cước cơ bản (Express Delivery)', 'Phụ phí xăng dầu', 'Phí xử lý đơn hàng', 'VAT',
    ]);
  });

  it('phụ phí giao nhà dân/ký nhận từ bill được cộng vào giá thu (không bị thiếu)', () => {
    // Trường hợp SV-0010: quote không có residential/ký nhận, bill có 92.700.
    const noSur = reconciledBrandCharge({ ...base, transportSurchargesVnd: 0 });
    const withSur = reconciledBrandCharge({ ...base, transportSurchargesVnd: 92_700 });
    expect(withSur.chargedVnd).toBeGreaterThan(noSur.chargedVnd);
    // Chênh = 92.700 × (1+fuel%) × (1+vat%) = 92.700 × 1.3825 × 1.08
    const expectedDelta = Math.round((92_700 + Math.round(92_700 * 0.3825)) * 1.08);
    expect(withSur.chargedVnd - noSur.chargedVnd).toBe(expectedDelta);
  });
});

describe('reconciledBrandCharge — duty (thuế/hải quan)', () => {
  const base = {
    baseVnd: 1_000_000, markupPercent: 20,
    transportSurchargesVnd: 0, customsSurchargesVnd: 0,
    fuelPercent: 38.25, vatPercent: 8, serviceLabel: 'Express Delivery',
  };
  it('duty cộng thẳng vào tổng — KHÔNG fuel, KHÔNG VAT', () => {
    const no = reconciledBrandCharge(base);
    const yes = reconciledBrandCharge({ ...base, dutyVnd: 15_531_089 });
    expect(yes.dutyVnd).toBe(15_531_089);
    // Chênh đúng bằng duty (không nhân thêm gì)
    expect(yes.chargedVnd - no.chargedVnd).toBe(15_531_089);
    // Fuel và VAT không đổi khi thêm duty
    expect(yes.fuelVnd).toBe(no.fuelVnd);
    expect(yes.vatVnd).toBe(no.vatVnd);
  });
  it('có duty → thêm dòng "Thuế/hải quan (theo bill)"; tổng lines == chargedVnd', () => {
    const r = reconciledBrandCharge({ ...base, dutyVnd: 500_000 });
    expect(r.lines.some((l) => l.label === 'Thuế/hải quan (theo bill)')).toBe(true);
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });
});
