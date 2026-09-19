import { describe, it, expect } from 'vitest';
import { hangTheoMaVanDon } from './ma-van-don';

describe('hangTheoMaVanDon', () => {
  it('bốn hãng theo dạng mã đã kiểm trên DB', () => {
    expect(hangTheoMaVanDon('873911393038')).toBe('fedex');
    expect(hangTheoMaVanDon('3527896700')).toBe('dhl');
    expect(hangTheoMaVanDon('35278967006')).toBe('aramex');
    expect(hangTheoMaVanDon('1Z2050VDDG23324091')).toBe('ups');
    expect(hangTheoMaVanDon('1z2050vddg23324091')).toBe('ups');
  });
  it('bỏ khoảng trắng', () => {
    expect(hangTheoMaVanDon(' 8739 1139 3038 ')).toBe('fedex');
  });
  it('dạng lạ / trống → null, không đoán', () => {
    expect(hangTheoMaVanDon('TO123')).toBeNull();
    expect(hangTheoMaVanDon('1234567890123')).toBeNull();
    expect(hangTheoMaVanDon('')).toBeNull();
    expect(hangTheoMaVanDon(null)).toBeNull();
  });
});
