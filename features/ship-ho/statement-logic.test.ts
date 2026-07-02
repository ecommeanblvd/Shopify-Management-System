import { describe, it, expect } from 'vitest';
import { summarizeStatement } from './statement-logic';

describe('summarizeStatement', () => {
  it('tổng chargedVnd + đếm đơn', () => {
    expect(summarizeStatement([100000, 250000, 50000])).toEqual({ orderCount: 3, totalChargedVnd: 400000 });
  });
  it('rỗng → 0/0', () => {
    expect(summarizeStatement([])).toEqual({ orderCount: 0, totalChargedVnd: 0 });
  });
  it('làm tròn tổng về VND', () => {
    expect(summarizeStatement([100000.4, 99999.6])).toEqual({ orderCount: 2, totalChargedVnd: 200000 });
  });
});
