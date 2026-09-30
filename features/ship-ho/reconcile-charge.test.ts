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
  it('duty KHÔNG cộng vào chargedVnd — dutyVnd trả riêng, KHÔNG fuel KHÔNG VAT (tách 21/09)', () => {
    const no = reconciledBrandCharge(base);
    const yes = reconciledBrandCharge({ ...base, dutyVnd: 15_531_089 });
    expect(yes.dutyVnd).toBe(15_531_089);
    // chargedVnd KHÔNG đổi khi thêm duty (duty tách riêng từ 21/09)
    expect(yes.chargedVnd).toBe(no.chargedVnd);
    // Fuel và VAT không đổi khi thêm duty
    expect(yes.fuelVnd).toBe(no.fuelVnd);
    expect(yes.vatVnd).toBe(no.vatVnd);
  });
  it('có duty → KHÔNG có dòng "Thuế/hải quan"; tổng lines == chargedVnd (tách 21/09)', () => {
    const r = reconciledBrandCharge({ ...base, dutyVnd: 500_000 });
    expect(r.lines.some((l) => l.label.includes('Thuế'))).toBe(false);
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });

  it('duty KHÔNG nằm trong chargedVnd, không có dòng duty; dutyVnd trả riêng (spec tách duty 21/09)', () => {
    const khong = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300 });
    const co = reconciledBrandCharge({ ...base, customsSurchargesVnd: 68_300, dutyVnd: 736_241 });
    expect(co.chargedVnd).toBe(khong.chargedVnd);
    expect(co.dutyVnd).toBe(736_241);
    expect(co.lines.some((l) => l.label.includes('Thuế'))).toBe(false);
    expect(co.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(co.chargedVnd);
  });
});

/**
 * Neo tiền THẬT — đơn #KLS1990 (26-INSLG-SV-0002, brand kalisa, hoá đơn FedEx 734105850).
 * Cùng một hoá đơn, chỉ đổi markup là giá nhảy 144.540đ. Bậc của kalisa là Platinum (8%);
 * cột `markup_percent` trên đơn còn giữ 20% legacy từ trước khi có hệ bậc. Con số 1.567.050
 * là giá SMS đã bắn sang MMP ngày 23/07 và cũng là con số trong file đối soát tay.
 */
describe('reconciledBrandCharge — neo #KLS1990 (CEO 30/09: tính lại theo BẬC)', () => {
  const bill = {
    baseVnd: 806_720,            // cước net trên bill = base − chiết khấu
    transportSurchargesVnd: 92_700,  // ký nhận trực tiếp
    customsSurchargesVnd: 68_300,    // phí xử lý hàng nhập khẩu
    fuelPercent: 38.25, vatPercent: 8, serviceLabel: 'Express Delivery',
  };

  it('markup 8% (Platinum — bậc của kalisa) → 1.567.050đ, đúng giá đã gửi MMP 23/07', () => {
    const r = reconciledBrandCharge({ ...bill, markupPercent: 8 });
    expect(r.markedBaseVnd).toBe(871_258);
    expect(r.fuelVnd).toBe(368_714);
    expect(r.vatVnd).toBe(116_078);
    expect(r.chargedVnd).toBe(1_567_050);
  });

  it('markup 20% (giá trị legacy trên cột đơn) → 1.711.590đ: thu thừa 144.540đ', () => {
    const r = reconciledBrandCharge({ ...bill, markupPercent: 20 });
    expect(r.chargedVnd).toBe(1_711_590);
    expect(r.chargedVnd - 1_567_050).toBe(144_540);
  });
});
