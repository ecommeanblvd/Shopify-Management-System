import { describe, it, expect } from 'vitest';
import {
  SHIP_HO_TIERS, RACK_MARKUP_PERCENT, tierForVolume, resolveTier, effectiveMarkupPercent,
  type ShipHoTierCode,
} from './tier-pricing';

describe('SHIP_HO_TIERS (thang chốt: +20/+16/+12/+8 trên base)', () => {
  it('4 bậc, rack 40% (chỉ trình bày CK), sàn volume ĐÚNG 8%', () => {
    expect(RACK_MARKUP_PERCENT).toBe(40);
    expect(SHIP_HO_TIERS).toHaveLength(4);
    const platinum = SHIP_HO_TIERS.find((t) => t.code === 'platinum')!;
    expect(effectiveMarkupPercent(platinum.discountPct)).toBeCloseTo(8, 6); // exact sàn
  });
  it('markup hiệu dụng từng bậc ĐÚNG: 20 / 16 / 12 / 8', () => {
    const by = Object.fromEntries(SHIP_HO_TIERS.map((t) => [t.code, effectiveMarkupPercent(t.discountPct)]));
    expect(by.standard).toBeCloseTo(20, 6);
    expect(by.silver).toBeCloseTo(16, 6);
    expect(by.gold).toBeCloseTo(12, 6);
    expect(by.platinum).toBeCloseTo(8, 6);
  });
});

describe('tierForVolume — ngưỡng biên <50/50-99/100-199/>=200', () => {
  const cases: Array<[number, ShipHoTierCode]> = [
    [0, 'standard'], [49, 'standard'],
    [50, 'silver'], [99, 'silver'],
    [100, 'gold'], [199, 'gold'],
    [200, 'platinum'], [1000, 'platinum'],
  ];
  for (const [n, code] of cases) it(`${n} đơn → ${code}`, () => expect(tierForVolume(n)).toBe(code));
});

describe('resolveTier — ưu tiên strategic > override > auto > standard', () => {
  it('strategic luôn platinum bất kể gì', () => {
    expect(resolveTier({ strategic: true, overrideCode: 'standard', autoCode: 'silver' }).code).toBe('platinum');
  });
  it('override thắng auto', () => {
    expect(resolveTier({ strategic: false, overrideCode: 'gold', autoCode: 'standard' }).code).toBe('gold');
  });
  it('override rác → bỏ qua, dùng auto', () => {
    expect(resolveTier({ strategic: false, overrideCode: 'unobtainium', autoCode: 'silver' }).code).toBe('silver');
  });
  it('không gì cả → standard', () => {
    expect(resolveTier({ strategic: false, overrideCode: null, autoCode: null }).code).toBe('standard');
  });
});
