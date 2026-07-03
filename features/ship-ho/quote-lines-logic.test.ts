import { describe, it, expect } from 'vitest';
import { summarizeLine } from './quote-lines-logic';

describe('summarizeLine', () => {
  it('charged = carrierCost + base×markup, margin = base×markup', () => {
    // carrierCost 250k, base 100k, markup 30% → margin 30k, charged 280k
    expect(summarizeLine(250000, 100000, 30)).toEqual({ chargedVnd: 280000, marginVnd: 30000 });
  });
  it('markup 0 → charged = carrierCost, margin 0', () => {
    expect(summarizeLine(150000, 90000, 0)).toEqual({ chargedVnd: 150000, marginVnd: 0 });
  });
  it('margin không phụ thuộc phần phụ phí trong carrierCost', () => {
    expect(summarizeLine(500000, 100000, 30).marginVnd).toBe(30000);
  });
});
