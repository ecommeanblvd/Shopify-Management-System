import { describe, it, expect } from 'vitest';
import { bakeAramex, bakeAramexSurcharges, ARAMEX_SURCHARGES } from './aramex-surcharges';

describe('bakeAramex', () => {
  it('bakes fuel + VAT for fuelable surcharges (×(1+fuel)×1.08)', () => {
    expect(bakeAramex(15, true, 30)).toBe(21.06); // 15 × 1.30 × 1.08
    expect(bakeAramex(110, true, 30)).toBe(154.44);
    expect(bakeAramex(315, true, 30)).toBe(442.26);
  });
  it('bakes VAT only for non-fuelable (DDP)', () => {
    expect(bakeAramex(30, false, 30)).toBe(32.4); // 30 × 1.08, fuel không áp
    expect(bakeAramex(30, false, 34)).toBe(32.4); // fuel đổi không ảnh hưởng DDP
  });
  it('re-bakes when fuel changes', () => {
    expect(bakeAramex(15, true, 34)).toBe(21.71); // 15 × 1.34 × 1.08 = 21.708 → 21.71
    expect(bakeAramex(35, true, 34)).toBe(50.65); // 35 × 1.34 × 1.08
  });
});

describe('bakeAramexSurcharges', () => {
  it('produces 9 rows with correct all-in values at fuel 30%', () => {
    const rows = bakeAramexSurcharges(30);
    expect(rows).toHaveLength(9);
    const values = rows.map((r) => r.value);
    expect(values).toEqual([21.06, 8.42, 42.12, 154.44, 115.83, 442.26, 49.14, 56.16, 32.4]);
  });
  it('bakes remote per-kg floor (value + valuePerKg both all-in)', () => {
    const remote = bakeAramexSurcharges(30).find((r) => r.kind === 'remote_fixed')!;
    expect(remote.value).toBe(42.12); // 30 × 1.404
    expect(remote.valuePerKg).toBe(0.7); // 0.5 × 1.404 = 0.7016 → 0.70
  });
  it('DDP is the only non-fuel row — VAT-only regardless of fuel', () => {
    const ddp30 = bakeAramexSurcharges(30).find((r) => r.note.includes('DDP'))!;
    const ddp34 = bakeAramexSurcharges(34).find((r) => r.note.includes('DDP'))!;
    expect(ddp30.value).toBe(32.4);
    expect(ddp34.value).toBe(32.4);
  });
  it('country_fixed rows carry their embargo/risk country lists', () => {
    const rows = bakeAramexSurcharges(30);
    const cf = rows.filter((r) => r.kind === 'country_fixed');
    expect(cf).toHaveLength(2);
    expect(cf.find((r) => r.value === 49.14)!.countryCodes).toContain('AF'); // Elevated Risk
    expect(cf.find((r) => r.value === 56.16)!.countryCodes).toContain('KP'); // Restricted (North Korea)
  });
  it('every fuelable raw amount matches the công văn source', () => {
    const raws = ARAMEX_SURCHARGES.map((s) => s.rawUsd);
    expect(raws).toEqual([15, 6.0, 30, 110, 82.5, 315, 35, 40, 30]);
  });
});
