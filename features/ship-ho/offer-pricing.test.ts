import { describe, it, expect } from 'vitest';
import { computeOffer, grossedMarginVnd, ORDER_PROCESSING_FEE_VND, processingFeeWithVat } from './offer-pricing';

describe('computeOffer — công thức CEO 08/09: ((base + markup + phụ phí)×(1+fuel) + 50k)×(1+VAT)', () => {
  it('charged = carrierCost + base×markup%×(1+fuel)×(1+VAT) + phí xử lý(50k+VAT)', () => {
    // base 100k, markup 30%, fuel 17%, VAT 8% → margin round(30000×1.17×1.08) = 37908
    // phí xử lý 50k×1.08 = 54k; carrierCost 250k → charged 250000 + 37908 + 54000 = 341908
    expect(computeOffer(250000, 100000, 30, 8, 17)).toEqual({ chargedVnd: 341908, marginVnd: 37908, processingFeeVnd: 54000 });
  });
  it('khớp công thức gốc viết thẳng: ((base + markup + phụ phí)×(1+fuel) + 50k)×(1+VAT)', () => {
    const base = 806_720, sur = 92_700, fuel = 38.25, vat = 8, markup = 8;
    const carrierCost = Math.round((base + sur) * (1 + fuel / 100) * (1 + vat / 100));
    const truth = Math.round(((base + base * markup / 100 + sur) * (1 + fuel / 100) + 50_000) * (1 + vat / 100));
    // sai số chỉ do làm tròn từng khoản (≤ 2 VND)
    expect(Math.abs(computeOffer(carrierCost, base, markup, vat, fuel).chargedVnd - truth)).toBeLessThanOrEqual(2);
  });
  it('margin CHỈ theo base — carrierCost lớn không đổi margin; phí xử lý cố định', () => {
    const a = computeOffer(250000, 100000, 30, 8, 17);
    const b = computeOffer(999000, 100000, 30, 8, 17);
    expect(a.marginVnd).toBe(b.marginVnd); // 37908
    expect(a.processingFeeVnd).toBe(54000);
    expect(b.chargedVnd).toBe(999000 + 37908 + 54000);
  });
  it('markup 0 → margin 0 nhưng VẪN có phí xử lý: charged = carrierCost + phí xử lý', () => {
    expect(computeOffer(250000, 100000, 0, 8, 17)).toEqual({ chargedVnd: 304000, marginVnd: 0, processingFeeVnd: 54000 });
  });
  it('fuel 0 + VAT 0 → margin phẳng base×markup, phí xử lý 50.000', () => {
    expect(computeOffer(250000, 100000, 30, 0, 0)).toEqual({ chargedVnd: 330000, marginVnd: 30000, processingFeeVnd: 50000 });
  });
  it('làm tròn VND cả margin lẫn phí xử lý', () => {
    // 100000 × 15.5% × 1.17 × 1.08 = 19585.8 → 19586
    expect(computeOffer(200000, 100000, 15.5, 8, 17)).toEqual({ chargedVnd: 273586, marginVnd: 19586, processingFeeVnd: 54000 });
  });
  it('markup âm không cho margin âm (clamp ≥ 0), phí xử lý vẫn cộng', () => {
    expect(computeOffer(200000, 100000, -50, 8, 17)).toEqual({ chargedVnd: 254000, marginVnd: 0, processingFeeVnd: 54000 });
  });
  it('hằng số phí xử lý = 50.000, helper đúng', () => {
    expect(ORDER_PROCESSING_FEE_VND).toBe(50000);
    expect(processingFeeWithVat(8)).toBe(54000);
    expect(processingFeeWithVat(0)).toBe(50000);
    expect(grossedMarginVnd(100000, 30, 17, 8)).toBe(37908);
  });
});
