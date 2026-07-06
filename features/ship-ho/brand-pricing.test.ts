import { describe, it, expect } from 'vitest';
import { computeBrandCharge } from './brand-pricing';

const STD = {
  carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
  parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
  serviceLabel: 'Express Delivery',
};

describe('computeBrandCharge (Option A: fuel/VAT trên base markup + phí xử lý chịu VAT)', () => {
  it('khớp ví dụ chuẩn: base 100k markup 30% fuel 17% vat 8% + phí xử lý 54k', () => {
    // carrierCost 151632 + margin round(30000×1.17×1.08=37908) + phí xử lý round(50000×1.08=54000)
    const r = computeBrandCharge(STD);
    expect(r.chargedVnd).toBe(243540); // 151632 + 37908 + 54000
  });
  it('tổng lines == chargedVnd', () => {
    const r = computeBrandCharge(STD);
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });
  it('line đầu là markedBase = base×(1+markup), nhãn service', () => {
    const r = computeBrandCharge(STD);
    expect(r.lines[0]).toEqual({ label: 'Cước cơ bản (Express Delivery)', amountVnd: 130000 });
  });
  it('CÓ dòng "Phí xử lý đơn hàng" = 50.000 (chưa VAT); VAT của phí gộp vào dòng VAT', () => {
    const r = computeBrandCharge(STD);
    expect(r.lines).toContainEqual({ label: 'Phí xử lý đơn hàng', amountVnd: 50000 });
    // VAT residual = carrier VAT 11232 + margin VAT 2808 + phí VAT 4000 = 18040
    expect(r.lines.find((l) => l.label === 'VAT')!.amountVnd).toBe(18040);
  });
  it('KHÔNG còn dòng "Phí đóng gói"', () => {
    const r = computeBrandCharge(STD);
    expect(r.lines.some((l) => l.label === 'Phí đóng gói')).toBe(false);
  });
  it('markup 0 → charged = carrierCost + phí xử lý (không còn = carrierCost)', () => {
    const r = computeBrandCharge({ ...STD, markupPercent: 0 });
    expect(r.chargedVnd).toBe(151632 + 54000);
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });
  it('fuel 0, vat 0 → margin base×markup, phí xử lý 50k phẳng', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 120000, baseVnd: 100000, fuelPercent: 0, vatPercent: 0, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 0, vatRealVnd: 0 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(200000); // 120000 + 30000 + 50000
    expect(r.lines.find((l) => l.label === 'Phí xử lý đơn hàng')!.amountVnd).toBe(50000);
    expect(r.lines.find((l) => l.label === 'VAT')!.amountVnd).toBe(0);
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });
});
