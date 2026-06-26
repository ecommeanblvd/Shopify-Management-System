import { describe, it, expect } from 'vitest';
import { ARAMEX_COUNTRIES, ARAMEX_TIER_UPPERS, ARAMEX_ZONE_LABELS } from './aramex-hn-zones';

describe('aramex zones/tiers', () => {
  it('20 nước, ISO-2 hợp lệ, không trùng', () => {
    expect(ARAMEX_COUNTRIES).toHaveLength(20);
    const isos = ARAMEX_COUNTRIES.map((c) => c.iso);
    expect(new Set(isos).size).toBe(20);
    expect(isos.every((i) => /^[A-Z]{2}$/.test(i))).toBe(true);
    expect(ARAMEX_COUNTRIES[0]).toEqual({ label: 'Bahrain', iso: 'BH' });
    expect(ARAMEX_COUNTRIES.find((c) => c.label === 'Japan')?.iso).toBe('JP');
    expect(ARAMEX_COUNTRIES.find((c) => c.label === 'Hong Kong')?.iso).toBe('HK');
  });
  it('tiers 0.5..20 bậc 0.5 (40 bậc)', () => {
    expect(ARAMEX_TIER_UPPERS).toHaveLength(40);
    expect(ARAMEX_TIER_UPPERS[0]).toBe(0.5);
    expect(ARAMEX_TIER_UPPERS[39]).toBe(20);
  });
  it('zone labels = country labels', () => {
    expect(ARAMEX_ZONE_LABELS).toEqual(ARAMEX_COUNTRIES.map((c) => c.label));
  });
});
