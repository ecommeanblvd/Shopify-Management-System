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

describe('giaThuBangKe — bảng kê CHỈ thu giá thực đã chốt (CEO 21/09, bỏ luật 08/09)', () => {
  it('reconciled + có giá thực → giá thực', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: 'reconciled' })).toBe(3021319);
  });
  it('chưa reconciled → null dù có actualChargedVnd sót', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: null })).toBeNull();
  });
  it('reconciled nhưng chưa tính được giá thực → null (không lấy giá báo)', () => {
    expect(giaThuBangKe({ actualChargedVnd: null, reconcileStatus: 'reconciled' })).toBeNull();
  });
});
