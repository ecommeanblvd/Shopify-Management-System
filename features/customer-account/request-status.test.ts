import { describe, it, expect } from 'vitest';
import { canTransition, OPEN_STATUSES } from './request-status';

describe('canTransition', () => {
  it('cancel: chỉ refund_pending → refunded', () => {
    expect(canTransition('cancel', 'refund_pending', 'refunded')).toBe(true);
    expect(canTransition('cancel', 'submitted', 'approved')).toBe(false);
  });
  it('claim: luồng chuẩn', () => {
    expect(canTransition('claim', 'submitted', 'under_review')).toBe(true);
    expect(canTransition('claim', 'submitted', 'approved')).toBe(true);     // skip review
    expect(canTransition('claim', 'submitted', 'rejected')).toBe(true);
    expect(canTransition('claim', 'under_review', 'approved')).toBe(true);
    expect(canTransition('claim', 'approved', 'return_in_transit')).toBe(true); // khách nhập tracking
    expect(canTransition('claim', 'return_in_transit', 'received')).toBe(true);
    expect(canTransition('claim', 'received', 'refund_pending')).toBe(true);    // QC pass
    expect(canTransition('claim', 'received', 'rejected')).toBe(true);          // QC fail
    expect(canTransition('claim', 'refund_pending', 'refunded')).toBe(true);
  });
  it('chặn nhảy bậy', () => {
    expect(canTransition('claim', 'approved', 'refunded')).toBe(false);
    expect(canTransition('claim', 'rejected', 'approved')).toBe(false);
  });
  it('OPEN_STATUSES không chứa trạng thái kết thúc', () => {
    expect(OPEN_STATUSES).not.toContain('rejected');
    expect(OPEN_STATUSES).not.toContain('refunded');
  });
});
