import { describe, it, expect } from 'vitest';
import { kepSoLuong } from './Stepper';

describe('kepSoLuong', () => {
  it('giữ nguyên số nguyên hợp lệ trong khoảng', () => {
    expect(kepSoLuong(5)).toBe(5);
  });
  it('chặn dưới ở toiThieu (mặc định 1)', () => {
    expect(kepSoLuong(0)).toBe(1);
    expect(kepSoLuong(-3)).toBe(1);
  });
  it('làm tròn số thập phân', () => {
    expect(kepSoLuong(2.6)).toBe(3);
    expect(kepSoLuong(2.4)).toBe(2);
  });
  it('NaN hoặc Infinity thì về toiThieu', () => {
    expect(kepSoLuong(NaN)).toBe(1);
    expect(kepSoLuong(Infinity)).toBe(1);
    expect(kepSoLuong(-Infinity)).toBe(1);
  });
  it('toiThieu tuỳ chỉnh', () => {
    expect(kepSoLuong(0, 5)).toBe(5);
    expect(kepSoLuong(10, 5)).toBe(10);
  });
});
