import { describe, it, expect } from 'vitest';
import { kyNhanTheoBaoGia } from './carrier-select-actions';

describe('kyNhanTheoBaoGia', () => {
  it('báo giá đã cộng ký nhận → so sánh line cũng tính', () => {
    expect(kyNhanTheoBaoGia({ addons: 92_700 })).toBe(true);
  });
  it('báo giá không cộng → không tính (ship hộ không auto thu)', () => {
    expect(kyNhanTheoBaoGia({ addons: 0 })).toBe(false);
  });
  it('thiếu báo giá / thiếu trường → false, đoán "có" là tính dư cho brand', () => {
    expect(kyNhanTheoBaoGia(null)).toBe(false);
    expect(kyNhanTheoBaoGia(undefined)).toBe(false);
    expect(kyNhanTheoBaoGia({})).toBe(false);
    expect(kyNhanTheoBaoGia({ addons: null })).toBe(false);
  });
});
