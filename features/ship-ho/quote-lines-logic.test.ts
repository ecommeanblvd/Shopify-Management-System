import { describe, it, expect } from 'vitest';
import { summarizeLine } from './quote-lines-logic';

describe('summarizeLine (giá thu + phí xử lý chịu VAT)', () => {
  it('charged = carrierCost + base×markup + phí xử lý(50k+VAT); margin = base×markup', () => {
    // carrierCost 250k, base 100k, markup 30%, vat 8% → margin 30k, phí 54k, charged 334k
    expect(summarizeLine(250000, 100000, 30, 8)).toEqual({ chargedVnd: 334000, marginVnd: 30000, processingFeeVnd: 54000 });
  });
  it('markup 0 → margin 0 nhưng vẫn có phí xử lý', () => {
    expect(summarizeLine(150000, 90000, 0, 8)).toEqual({ chargedVnd: 204000, marginVnd: 0, processingFeeVnd: 54000 });
  });
  it('margin không phụ thuộc phần phụ phí trong carrierCost', () => {
    expect(summarizeLine(500000, 100000, 30, 8).marginVnd).toBe(30000);
  });
});
