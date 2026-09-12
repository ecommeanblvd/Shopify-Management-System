import { describe, it, expect } from 'vitest';
import { soNgayShipHo } from './nguon-ship-ho';

describe('soNgayShipHo', () => {
  it('đếm từ ĐẦU ngày gửi tới mốc giao', () => {
    expect(soNgayShipHo('2026-08-01', '2026-08-06T09:00:00Z')).toBe(5.4);
  });

  it('kẹp về 0 khi giao ngay trong ngày gửi, không ra số âm vì lệch múi giờ', () => {
    expect(soNgayShipHo('2026-08-01', '2026-07-31T20:00:00Z')).toBe(0);
  });

  it('bỏ phần giờ của ngày gửi để hai nguồn dùng cùng một mốc', () => {
    expect(soNgayShipHo('2026-08-01T23:00:00Z', '2026-08-03T00:00:00Z')).toBe(2);
  });
});
