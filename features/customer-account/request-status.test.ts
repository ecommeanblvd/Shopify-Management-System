import { describe, it, expect } from 'vitest';
import { canTransition, OPEN_STATUSES, validateClaimInput } from './request-status';

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

describe('validateClaimInput', () => {
  it('toàn rác → error select at least one issue', () => {
    const r = validateClaimInput(['garbage', 'nonsense'], ['p1.jpg']);
    expect(r).toEqual({ ok: false, error: 'select at least one issue' });
  });
  it('rác lẫn hợp lệ → ok, âm thầm loại bỏ rác', () => {
    const r = validateClaimInput(['other', 'garbage'], ['p1.jpg']);
    expect(r).toEqual({ ok: true, reasons: ['other'] });
  });
  it('0 ảnh → error photos: 1-5 required', () => {
    const r = validateClaimInput(['other'], []);
    expect(r).toEqual({ ok: false, error: 'photos: 1-5 required' });
  });
  it('6 ảnh → error photos: 1-5 required', () => {
    const r = validateClaimInput(['other'], ['1', '2', '3', '4', '5', '6']);
    expect(r).toEqual({ ok: false, error: 'photos: 1-5 required' });
  });
  it('1-5 ảnh hợp lệ → ok', () => {
    expect(validateClaimInput(['other'], ['1'])).toEqual({ ok: true, reasons: ['other'] });
    expect(validateClaimInput(['other'], ['1', '2', '3', '4', '5'])).toEqual({ ok: true, reasons: ['other'] });
  });
});
