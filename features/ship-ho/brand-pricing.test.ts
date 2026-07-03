import { describe, it, expect } from 'vitest';
import { computeBrandCharge } from './brand-pricing';

describe('computeBrandCharge (Option A: fuel/VAT trên base đã markup)', () => {
  it('khớp ví dụ chuẩn: base 100k markup 30% fuel 17% vat 8%', () => {
    // carrierCost = base(100k) + surcharges(20k) + fuelReal(20.4k) + vatReal(11.232k) = 151.632k
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(189540); // 151632 + round(30000×1.17×1.08=37908)
  });
  it('tổng lines == chargedVnd', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.lines.reduce((s, l) => s + l.amountVnd, 0)).toBe(r.chargedVnd);
  });
  it('line đầu là markedBase = base×(1+markup), nhãn service', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.lines[0]).toEqual({ label: 'Cước cơ bản (Express Delivery)', amountVnd: 130000 });
  });
  it('markup 0 → charged = carrierCost', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 151632, baseVnd: 100000, fuelPercent: 17, vatPercent: 8, markupPercent: 0,
      parts: { surchargesVnd: 20000, fuelRealVnd: 20400, vatRealVnd: 11232 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(151632);
  });
  it('fuel 0, vat 0 → margin = base×markup thuần', () => {
    const r = computeBrandCharge({
      carrierCostVnd: 120000, baseVnd: 100000, fuelPercent: 0, vatPercent: 0, markupPercent: 30,
      parts: { surchargesVnd: 20000, fuelRealVnd: 0, vatRealVnd: 0 },
      serviceLabel: 'Express Delivery',
    });
    expect(r.chargedVnd).toBe(150000); // 120000 + 30000
  });
});
