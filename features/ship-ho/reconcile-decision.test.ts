import { describe, it, expect } from 'vitest';
import { decideReconcile, REVIEW_TOLERANCE_VND } from './reconcile-decision';

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
});
