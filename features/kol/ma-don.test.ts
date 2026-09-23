import { describe, it, expect } from 'vitest';
import { maDonKol } from './ma-don';

describe('maDonKol', () => {
  it('dựng mã theo năm-tháng (giờ kinh doanh) và số thứ tự đệm 4 chữ số', () => {
    expect(maDonKol(7, new Date('2026-09-23T10:00:00Z'))).toBe('KOL-2609-0007');
  });
  it('số vượt 4 chữ số thì KHÔNG cắt, để mã vẫn duy nhất', () => {
    expect(maDonKol(12345, new Date('2026-09-23T10:00:00Z'))).toBe('KOL-2609-12345');
  });
  it('ranh tháng ở giờ kinh doanh (Asia/Bangkok): 00:00 ngày 1/10 VN = 17:00 ngày 30/9 UTC, mã ghi tháng 10', () => {
    // 2026-10-01T00:00:00+07:00 tương đương 2026-09-30T17:00:00Z
    expect(maDonKol(8, new Date('2026-09-30T17:00:00Z'))).toBe('KOL-2610-0008');
  });
  it('số thứ tự âm thì throw', () => {
    expect(() => maDonKol(-1, new Date('2026-09-23T10:00:00Z'))).toThrow();
  });
  it('số thứ tự không phải số nguyên thì throw', () => {
    expect(() => maDonKol(3.5, new Date('2026-09-23T10:00:00Z'))).toThrow();
  });
  it('số thứ tự bằng 0 thì throw', () => {
    expect(() => maDonKol(0, new Date('2026-09-23T10:00:00Z'))).toThrow();
  });
});
