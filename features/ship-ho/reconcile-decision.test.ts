import { describe, it, expect } from 'vitest';
import { decideReconcile, donDaDongBang, reconcileCellState, REVIEW_TOLERANCE_VND } from './reconcile-decision';

describe('decideReconcile', () => {
  it('khớp (delta trong tolerance) → decision null, tự đẩy giá', () => {
    expect(decideReconcile(0, null)).toEqual({ decision: null, shouldEmitCharge: true });
    expect(decideReconcile(REVIEW_TOLERANCE_VND, null)).toEqual({ decision: null, shouldEmitCharge: true });
    expect(decideReconcile(-REVIEW_TOLERANCE_VND, null)).toEqual({ decision: null, shouldEmitCharge: true });
  });

  it('có sai lệch (> tolerance) → pending_review, CHƯA đẩy giá', () => {
    expect(decideReconcile(50_000, null)).toEqual({ decision: 'pending_review', shouldEmitCharge: false });
    expect(decideReconcile(-50_000, null)).toEqual({ decision: 'pending_review', shouldEmitCharge: false });
    expect(decideReconcile(REVIEW_TOLERANCE_VND + 1, null)).toEqual({ decision: 'pending_review', shouldEmitCharge: false });
  });

  it('delta null (chưa có bill) → null, không đẩy... thực ra tự khớp = đẩy', () => {
    // deltaVnd null nghĩa là chưa tính được lệch → không coi là sai lệch → decision null.
    expect(decideReconcile(null, null)).toEqual({ decision: null, shouldEmitCharge: true });
  });

  it('đã ACCEPTED → giữ nguyên + đẩy giá (kể cả khi delta lớn); cron KHÔNG ghi đè', () => {
    expect(decideReconcile(50_000, 'accepted')).toEqual({ decision: 'accepted', shouldEmitCharge: true });
    expect(decideReconcile(0, 'accepted')).toEqual({ decision: 'accepted', shouldEmitCharge: true });
  });

  it('đang CLAIMING → giữ nguyên + KHÔNG đẩy giá; cron KHÔNG ghi đè', () => {
    expect(decideReconcile(50_000, 'claiming')).toEqual({ decision: 'claiming', shouldEmitCharge: false });
    expect(decideReconcile(0, 'claiming')).toEqual({ decision: 'claiming', shouldEmitCharge: false });
  });

  it('đang pending_review + cron chạy lại vẫn có sai lệch → vẫn pending_review', () => {
    expect(decideReconcile(50_000, 'pending_review')).toEqual({ decision: 'pending_review', shouldEmitCharge: false });
  });

  it('claim đã KẾT LUẬN (credited/rejected) → giữ + đẩy giá; cron KHÔNG ghi đè', () => {
    expect(decideReconcile(50_000, 'claim_credited')).toEqual({ decision: 'claim_credited', shouldEmitCharge: true });
    expect(decideReconcile(50_000, 'claim_rejected')).toEqual({ decision: 'claim_rejected', shouldEmitCharge: true });
  });
});

describe('reconcileCellState', () => {
  it('chưa reconciled: có tracking → Chờ bill; không tracking → —', () => {
    expect(reconcileCellState(null, null, true)).toEqual({ kind: 'waiting', label: 'Chờ bill', actionable: false });
    expect(reconcileCellState(null, null, false)).toEqual({ kind: 'none', label: '—', actionable: false });
  });
  it('reconciled + khớp/accepted/claim_* → Đã đối soát (không bấm)', () => {
    for (const d of [null, 'accepted', 'claim_credited', 'claim_rejected']) {
      expect(reconcileCellState('reconciled', d, true)).toEqual({ kind: 'done', label: '✓ Đã đối soát', actionable: false });
    }
  });
  it('pending_review → Cần đối soát (bấm được)', () => {
    expect(reconcileCellState('reconciled', 'pending_review', true)).toEqual({ kind: 'review', label: '⚠ Cần đối soát', actionable: true });
  });
  it('claiming → Đang claim (bấm được)', () => {
    expect(reconcileCellState('reconciled', 'claiming', true)).toEqual({ kind: 'claiming', label: '⏳ Đang claim', actionable: true });
  });
});

describe('donDaDongBang — đơn đã đối soát không tính lại khi bill không đổi (CEO 08/09)', () => {
  const daLuu = { reconcileStatus: 'reconciled', actualChargedVnd: 1_567_050, actualCarrierCostVnd: 1_416_688, billNumber: 'HANR000265761' };
  const bill = { billNumber: 'HANR000265761', totalVnd: 1_416_688 };
  it('cùng bill, cùng tổng, đã có giá thu thực → đóng băng', () => {
    expect(donDaDongBang(daLuu, bill)).toBe(true);
  });
  it('lệch tổng ≤ 1đ (làm tròn numeric) vẫn coi là cùng bill', () => {
    expect(donDaDongBang(daLuu, { ...bill, totalVnd: 1_416_688.4 })).toBe(true);
  });
  it('chưa reconciled → không đóng băng', () => {
    expect(donDaDongBang({ ...daLuu, reconcileStatus: null }, bill)).toBe(false);
  });
  it('chưa có giá thu thực (re-quote từng lỗi) → tính lại', () => {
    expect(donDaDongBang({ ...daLuu, actualChargedVnd: null }, bill)).toBe(false);
  });
  it('tổng bill đổi (bill thuế về sau / nạp lại có sửa) → tính lại', () => {
    expect(donDaDongBang(daLuu, { ...bill, totalVnd: 1_500_000 })).toBe(false);
  });
  it('số bill đổi → tính lại', () => {
    expect(donDaDongBang(daLuu, { ...bill, billNumber: 'HANR000264033' })).toBe(false);
  });
  it('đơn cũ chưa lưu số bill (null) nhưng tổng khớp → vẫn đóng băng', () => {
    expect(donDaDongBang({ ...daLuu, billNumber: null }, bill)).toBe(true);
  });
});
