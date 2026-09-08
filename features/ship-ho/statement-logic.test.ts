import { describe, it, expect } from 'vitest';
import { summarizeStatement, giaThuBangKe } from './statement-logic';

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

describe('giaThuBangKe — đơn đã có bill thu theo giá thực, chưa có bill thu giá báo (CEO 08/09)', () => {
  it('reconciled + có giá thực → giá thực (kể cả thấp hơn giá báo)', () => {
    expect(giaThuBangKe({ chargedVnd: '3205386', actualChargedVnd: '3021319', reconcileStatus: 'reconciled' })).toBe(3021319);
  });
  it('chưa reconciled → giá báo, dù có actualChargedVnd sót', () => {
    expect(giaThuBangKe({ chargedVnd: '3205386', actualChargedVnd: '3021319', reconcileStatus: null })).toBe(3205386);
  });
  it('reconciled nhưng chưa tính được giá thực (re-quote lỗi) → giá báo', () => {
    expect(giaThuBangKe({ chargedVnd: '3205386', actualChargedVnd: null, reconcileStatus: 'reconciled' })).toBe(3205386);
  });
  it('chưa báo giá → null', () => {
    expect(giaThuBangKe({ chargedVnd: null, actualChargedVnd: null, reconcileStatus: null })).toBeNull();
  });
});
