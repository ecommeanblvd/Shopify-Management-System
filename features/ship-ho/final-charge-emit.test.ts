import { describe, it, expect } from 'vitest';
import { nenBanGiaCuoi } from './final-charge-emit';

describe('nenBanGiaCuoi — chặn bắn trùng order.reconciled', () => {
  it('chưa gửi lần nào → bắn', () => {
    expect(nenBanGiaCuoi(1_521_831, null, null)).toBe(true);
    expect(nenBanGiaCuoi(1_521_831, null, undefined)).toBe(true);
  });

  it('trùng cả giá lẫn kết luận → KHÔNG bắn (ca 4 lần trùng trong outbox)', () => {
    expect(nenBanGiaCuoi(1_521_831, null, { finalChargedVnd: 1_521_831, reconcileResolution: null })).toBe(false);
  });

  it('giá đổi → bắn, dù chỉ lệch 1đ', () => {
    expect(nenBanGiaCuoi(1_521_833, null, { finalChargedVnd: 1_521_831, reconcileResolution: null })).toBe(true);
  });

  it('cùng giá nhưng có kết luận MỚI khác → vẫn bắn, đó là tin mới với MMP', () => {
    expect(nenBanGiaCuoi(1_521_831, 'internal_error', { finalChargedVnd: 1_521_831, reconcileResolution: null })).toBe(true);
    expect(nenBanGiaCuoi(1_521_831, 'claim_credited', { finalChargedVnd: 1_521_831, reconcileResolution: 'claim_rejected' })).toBe(true);
  });

  it('cron KHÔNG gửi kèm kết luận → vắng mặt không tính là đổi (đơn đã duyệt tay không bị bắn lại)', () => {
    expect(nenBanGiaCuoi(1_521_831, null, { finalChargedVnd: 1_521_831, reconcileResolution: 'internal_error' })).toBe(false);
    expect(nenBanGiaCuoi(1_521_831, undefined, { finalChargedVnd: 1_521_831, reconcileResolution: 'claim_credited' })).toBe(false);
  });

  it('nhưng giá đổi thì vẫn bắn dù không kèm kết luận', () => {
    expect(nenBanGiaCuoi(1_600_000, null, { finalChargedVnd: 1_521_831, reconcileResolution: 'internal_error' })).toBe(true);
  });

  it('trùng giá VÀ trùng kết luận → không bắn', () => {
    expect(nenBanGiaCuoi(1_521_831, 'internal_error', { finalChargedVnd: 1_521_831, reconcileResolution: 'internal_error' })).toBe(false);
  });

  it('so sánh theo số nguyên đồng — lệch phần thập phân không tính là đổi giá', () => {
    expect(nenBanGiaCuoi(1_521_831.4, null, { finalChargedVnd: 1_521_831, reconcileResolution: null })).toBe(false);
  });

  it('không có giá cuối → không bắn', () => {
    expect(nenBanGiaCuoi(null, null, null)).toBe(false);
    expect(nenBanGiaCuoi(undefined, null, null)).toBe(false);
  });
});
