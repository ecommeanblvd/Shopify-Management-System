import { describe, it, expect } from 'vitest';
import {
  SHIP_HO_TIERS, RACK_MARKUP_PERCENT, tierForVolume, resolveTier, effectiveMarkupPercent,
  type ShipHoTierCode,
} from './tier-pricing';

describe('SHIP_HO_TIERS', () => {
  it('7 bậc (5 volume + 2 nấc tay), rack 40%, sàn volume ĐÚNG 20%', () => {
    expect(RACK_MARKUP_PERCENT).toBe(40);
    expect(SHIP_HO_TIERS).toHaveLength(7);
    const platinum = SHIP_HO_TIERS.find((t) => t.code === 'platinum')!;
    expect(effectiveMarkupPercent(platinum.discountPct)).toBeCloseTo(20, 6); // exact sàn
  });
  it('markup hiệu dụng từng bậc: 40 / 34.4 / 30.2 / 26 / 20', () => {
    const by = Object.fromEntries(SHIP_HO_TIERS.map((t) => [t.code, effectiveMarkupPercent(t.discountPct)]));
    expect(by.standard).toBeCloseTo(40, 6);
    expect(by.bronze).toBeCloseTo(34.4, 6);
    expect(by.silver).toBeCloseTo(30.2, 6);
    expect(by.gold).toBeCloseTo(26, 6);
    expect(by.platinum).toBeCloseTo(20, 6);
  });
});

describe('tierForVolume — ngưỡng biên <20/20-49/50-99/100-199/>=200', () => {
  const cases: Array<[number, ShipHoTierCode]> = [
    [0, 'standard'], [19, 'standard'],
    [20, 'bronze'], [49, 'bronze'],
    [50, 'silver'], [99, 'silver'],
    [100, 'gold'], [199, 'gold'],
    [200, 'platinum'], [1000, 'platinum'],
  ];
  for (const [n, code] of cases) it(`${n} đơn → ${code}`, () => expect(tierForVolume(n)).toBe(code));
});

describe('resolveTier — ưu tiên strategic > override > auto > standard', () => {
  it('strategic luôn platinum bất kể gì', () => {
    expect(resolveTier({ strategic: true, overrideCode: 'standard', autoCode: 'bronze' }).code).toBe('platinum');
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

describe('2 nấc đặc biệt Diamond/Black (22/07) — dưới sàn volume, CHỈ admin gán tay', () => {
  it('diamond → markup hiệu dụng ĐÚNG 15%; black → ĐÚNG 10%', () => {
    const diamond = SHIP_HO_TIERS.find((t) => t.code === 'diamond')!;
    const black = SHIP_HO_TIERS.find((t) => t.code === 'black')!;
    expect(effectiveMarkupPercent(diamond.discountPct)).toBeCloseTo(15, 6);
    expect(effectiveMarkupPercent(black.discountPct)).toBeCloseTo(10, 6);
  });
  it('volume KHÔNG bao giờ tự đạt diamond/black (kể cả 10.000 đơn)', () => {
    expect(tierForVolume(10_000)).toBe('platinum');
  });
  it('admin override diamond/black → resolve đúng bậc', () => {
    expect(resolveTier({ strategic: false, overrideCode: 'diamond', autoCode: 'gold' }).code).toBe('diamond');
    expect(resolveTier({ strategic: false, overrideCode: 'black', autoCode: 'platinum' }).code).toBe('black');
  });
  it('strategic vẫn platinum (diamond/black chỉ qua override tay)', () => {
    expect(resolveTier({ strategic: true, overrideCode: 'black', autoCode: null }).code).toBe('platinum');
  });
});
