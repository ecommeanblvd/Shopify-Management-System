import { describe, it, expect } from 'vitest';
import { applyMarkup } from './markup';

describe('applyMarkup', () => {
  it('cộng markup% và làm tròn VND (0 lẻ)', () => {
    expect(applyMarkup(100000, 20)).toBe(120000);
    expect(applyMarkup(100000, 0)).toBe(100000);
  });

  it('làm tròn tới VND gần nhất', () => {
    // 100000 * 1.155 = 115500 ; 100001 * 1.1 = 110001.1 → 110001
    expect(applyMarkup(100000, 15.5)).toBe(115500);
    expect(applyMarkup(100001, 10)).toBe(110001);
  });

  it('markup âm không cho ra số âm (clamp ≥ 0)', () => {
    expect(applyMarkup(100000, -150)).toBe(0);
  });

  it('cost 0 → 0', () => {
    expect(applyMarkup(0, 50)).toBe(0);
  });
});
