import { describe, it, expect } from 'vitest';
import {SHIP_HO_TIERS, RACK_MARKUP_PERCENT, tierForVolume, resolveTier, effectiveMarkupPercent, type ShipHoTierCode, markupTheoBac, markupKhiReBill } from './tier-pricing';

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

describe('markupTheoBac / markupKhiReBill (CEO 08/09: tính theo đúng tier từng brand)', () => {
  it('markupTheoBac: override platinum → 8; silver → 16; strategic không override → 8; không đối tác → 20 (Standard)', () => {
    expect(markupTheoBac({ strategic: true, tierOverrideCode: 'platinum', tierCode: 'standard' })).toBe(8);
    expect(markupTheoBac({ strategic: false, tierOverrideCode: 'silver', tierCode: 'standard' })).toBe(16);
    expect(markupTheoBac({ strategic: true, tierOverrideCode: null, tierCode: 'standard' })).toBe(8);
    expect(markupTheoBac(null)).toBe(20);
  });
  it('markupTheoBac KHÔNG đọc cột markup_percent cũ', () => {
    expect(markupTheoBac({ strategic: false, tierOverrideCode: null, tierCode: 'standard', markupPercent: '30' } as never)).toBe(20);
  });
  it('markupKhiReBill: ưu tiên markup đã ghi trên đơn; thiếu/hỏng → bậc hiện tại', () => {
    expect(markupKhiReBill('30.0000', 8)).toBe(30);
    expect(markupKhiReBill(20, 8)).toBe(20);
    expect(markupKhiReBill(null, 8)).toBe(8);
    expect(markupKhiReBill('', 8)).toBe(8);
    expect(markupKhiReBill('abc', 8)).toBe(8);
    expect(markupKhiReBill('0', 8)).toBe(0); // markup 0 là hợp lệ (đối tác không markup)
  });
});
