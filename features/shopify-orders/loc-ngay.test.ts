import { describe, it, expect } from 'vitest';
import { laMocLoc, mocCuaDon, trongKhoang } from './loc-ngay';

describe('loc-ngay — lọc theo ngày đặt / ngày gửi', () => {
  const don = { processedAt: new Date('2026-08-05T10:00:00'), shippedAt: new Date('2026-09-02T09:00:00') };
  it('mốc order dùng processedAt, mốc ship dùng shippedAt; chưa gửi → null', () => {
    expect(mocCuaDon(don, 'order')).toEqual(don.processedAt);
    expect(mocCuaDon(don, 'ship')).toEqual(don.shippedAt);
    expect(mocCuaDon({ processedAt: don.processedAt, shippedAt: null }, 'ship')).toBeNull();
    expect(mocCuaDon({ processedAt: '2026-08-05T10:00:00', shippedAt: null }, 'order')).toEqual(new Date('2026-08-05T10:00:00'));
  });
  it('đơn đặt T8 gửi T9: lọc T8 theo ngày đặt có, theo ngày gửi không; lọc T9 ngược lại', () => {
    expect(trongKhoang(don, '2026-08-01', '2026-08-31', 'order')).toBe(true);
    expect(trongKhoang(don, '2026-08-01', '2026-08-31', 'ship')).toBe(false);
    expect(trongKhoang(don, '2026-09-01', '2026-09-30', 'order')).toBe(false);
    expect(trongKhoang(don, '2026-09-01', '2026-09-30', 'ship')).toBe(true);
  });
  it('khoảng bao trọn ngày biên (00:00 → 23:59:59.999); đơn chưa gửi không vào khoảng nào theo ngày gửi', () => {
    expect(trongKhoang({ processedAt: new Date('2026-08-31T23:30:00'), shippedAt: null }, '2026-08-31', '2026-08-31', 'order')).toBe(true);
    expect(trongKhoang({ processedAt: new Date('2026-08-31T23:30:00'), shippedAt: null }, '2026-01-01', '2026-12-31', 'ship')).toBe(false);
  });
  it('laMocLoc chỉ nhận order/ship', () => {
    expect(laMocLoc('order')).toBe(true); expect(laMocLoc('ship')).toBe(true); expect(laMocLoc('x')).toBe(false); expect(laMocLoc(undefined)).toBe(false);
  });
});
