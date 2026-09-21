import { describe, it, expect } from 'vitest';
import { summarizeStatement, giaThuBangKe, QUYET_DINH_DA_CHOT } from './statement-logic';

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
  it('reconciled + có giá thực (khớp bill, decision null) → giá thực', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: 'reconciled', reconcileDecision: null })).toBe(3021319);
  });
  it('chưa reconciled → null dù có actualChargedVnd sót', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: null, reconcileDecision: null })).toBeNull();
  });
  it('reconciled nhưng chưa tính được giá thực → null (không lấy giá báo)', () => {
    expect(giaThuBangKe({ actualChargedVnd: null, reconcileStatus: 'reconciled', reconcileDecision: null })).toBeNull();
  });

  // Spec §2.2: không thu brand một con số Đức CHƯA xác nhận.
  it('còn chờ Đức duyệt (pending_review) → null, dù đã reconciled và có giá thực', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: 'reconciled', reconcileDecision: 'pending_review' })).toBeNull();
  });
  it('đang claim carrier (claiming) → null', () => {
    expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: 'reconciled', reconcileDecision: 'claiming' })).toBeNull();
  });
  for (const d of QUYET_DINH_DA_CHOT) {
    it(`quyết định đã chốt (${d}) → thu giá thực`, () => {
      expect(giaThuBangKe({ actualChargedVnd: '3021319', reconcileStatus: 'reconciled', reconcileDecision: d })).toBe(3021319);
    });
  }
  it('QUYET_DINH_DA_CHOT khớp đúng 3 trạng thái đã có giá cuối', () => {
    expect([...QUYET_DINH_DA_CHOT]).toEqual(['accepted', 'claim_credited', 'claim_rejected']);
  });
});
