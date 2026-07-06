import { describe, it, expect } from 'vitest';
import { computeOffer, MIN_MARKUP_PERCENT, ORDER_PROCESSING_FEE_VND, processingFeeWithVat } from './offer-pricing';

describe('computeOffer (markup base-only + phí xử lý đơn hàng chịu VAT)', () => {
  it('charged = carrierCost + base×markup% + phí xử lý(50k+VAT)', () => {
    // base 100k, markup 30% → margin 30k; phí xử lý 50k×1.08=54k; carrierCost 250k
    // → charged 250k + 30k + 54k = 334k
    expect(computeOffer(250000, 100000, 30, 8)).toEqual({ chargedVnd: 334000, marginVnd: 30000, processingFeeVnd: 54000 });
  });
  it('margin CHỈ theo base — carrierCost lớn không đổi margin; phí xử lý cố định', () => {
    const a = computeOffer(250000, 100000, 30, 8);
    const b = computeOffer(999000, 100000, 30, 8);
    expect(a.marginVnd).toBe(b.marginVnd); // 30000
    expect(a.processingFeeVnd).toBe(54000);
    expect(b.chargedVnd).toBe(999000 + 30000 + 54000);
  });
  it('markup 0 → margin 0 nhưng VẪN có phí xử lý: charged = carrierCost + phí xử lý', () => {
    expect(computeOffer(250000, 100000, 0, 8)).toEqual({ chargedVnd: 304000, marginVnd: 0, processingFeeVnd: 54000 });
  });
  it('VAT 0 → phí xử lý = 50.000 phẳng', () => {
    expect(computeOffer(250000, 100000, 30, 0)).toEqual({ chargedVnd: 330000, marginVnd: 30000, processingFeeVnd: 50000 });
  });
  it('làm tròn VND cả margin lẫn phí xử lý', () => {
    // base 100000 × 15.5% = 15500; phí xử lý 50000×1.08=54000
    expect(computeOffer(200000, 100000, 15.5, 8)).toEqual({ chargedVnd: 269500, marginVnd: 15500, processingFeeVnd: 54000 });
  });
  it('markup âm không cho margin âm (clamp ≥ 0), phí xử lý vẫn cộng', () => {
    expect(computeOffer(200000, 100000, -50, 8)).toEqual({ chargedVnd: 254000, marginVnd: 0, processingFeeVnd: 54000 });
  });
  it('hằng số phí xử lý = 50.000, helper VAT đúng', () => {
    expect(ORDER_PROCESSING_FEE_VND).toBe(50000);
    expect(processingFeeWithVat(8)).toBe(54000);
    expect(processingFeeWithVat(0)).toBe(50000);
  });
  it('MIN_MARKUP_PERCENT = 30', () => {
    expect(MIN_MARKUP_PERCENT).toBe(30);
  });
});
