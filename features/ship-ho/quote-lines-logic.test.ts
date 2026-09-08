import { describe, it, expect } from 'vitest';
import { summarizeLine } from './quote-lines-logic';

describe('summarizeLine (cùng công thức computeOffer: margin qua fuel + VAT, phí xử lý chịu VAT)', () => {
  it('charged = carrierCost + base×markup×(1+fuel)×(1+VAT) + phí xử lý(50k+VAT)', () => {
    // carrierCost 250k, base 100k, markup 30%, fuel 17%, vat 8% → margin round(30000×1.17×1.08)=37908, phí 54k
    expect(summarizeLine(250000, 100000, 30, 8, 17)).toEqual({ chargedVnd: 341908, marginVnd: 37908, processingFeeVnd: 54000 });
  });
  it('markup 0 → margin 0 nhưng vẫn có phí xử lý', () => {
    expect(summarizeLine(150000, 90000, 0, 8, 17)).toEqual({ chargedVnd: 204000, marginVnd: 0, processingFeeVnd: 54000 });
  });
  it('margin không phụ thuộc phần phụ phí trong carrierCost', () => {
    expect(summarizeLine(500000, 100000, 30, 8, 17).marginVnd).toBe(37908);
  });
});
