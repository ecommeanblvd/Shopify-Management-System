import { describe, it, expect } from 'vitest';
import { laNhaDan } from './residential-from-class';

describe('laNhaDan', () => {
  it('RESIDENTIAL đã verify → nhà dân, bất kể nước', () => {
    expect(laNhaDan('RESIDENTIAL', 'US')).toBe(true);
    expect(laNhaDan('RESIDENTIAL', 'GB')).toBe(true);
  });
  it('BUSINESS đã verify → KHÔNG nhà dân, kể cả US/CA (chỗ cách đoán cũ tính dư)', () => {
    expect(laNhaDan('BUSINESS', 'US')).toBe(false);
    expect(laNhaDan('BUSINESS', 'CA')).toBe(false);
  });
  it('MIXED/UNKNOWN/chưa verify → mặc định theo nước', () => {
    for (const c of ['MIXED', 'UNKNOWN', null, undefined, '']) {
      expect(laNhaDan(c, 'US')).toBe(true);
      expect(laNhaDan(c, 'CA')).toBe(true);
      expect(laNhaDan(c, 'GB')).toBe(false);
    }
  });
  it('không phân biệt hoa thường và khoảng trắng', () => {
    expect(laNhaDan(' residential ', 'GB')).toBe(true);
    expect(laNhaDan('business', 'US')).toBe(false);
  });
  it('thiếu nước → không nhà dân', () => {
    expect(laNhaDan(null, null)).toBe(false);
  });
});
