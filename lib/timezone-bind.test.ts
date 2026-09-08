import { describe, it, expect } from 'vitest';
import { mocUtcNaive } from './timezone-bind';

describe('mocUtcNaive', () => {
  it('quy Date về chuỗi ISO UTC không có hậu tố Z', () => {
    expect(mocUtcNaive(new Date('2026-08-01T00:00:00+07:00'))).toBe('2026-07-31T17:00:00.000');
  });

  it('không phụ thuộc TZ tiến trình — hai Date dựng từ offset tường minh cùng instant phải ra cùng chuỗi bất kể process.env.TZ', () => {
    const truoc = process.env.TZ;
    try {
      // Node cache một số bảng TZ nội bộ nên đổi process.env.TZ giữa chừng
      // không đảm bảo Date/toLocale* đọc lại ngay — vì vậy so sánh trên hai
      // Date DỰNG SẴN với offset tường minh (không phụ thuộc TZ khi parse)
      // thay vì dựa vào việc đổi TZ có "ăn" hay không.
      process.env.TZ = 'Asia/Bangkok';
      const bangkok = mocUtcNaive(new Date('2026-08-01T00:00:00+07:00'));
      process.env.TZ = 'UTC';
      const utc = mocUtcNaive(new Date('2026-07-31T17:00:00Z'));
      expect(bangkok).toBe(utc);
      expect(bangkok).toBe('2026-07-31T17:00:00.000');
    } finally {
      process.env.TZ = truoc;
    }
  });
});
