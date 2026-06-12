import { describe, it, expect } from 'vitest';
import { buildDemandRows } from './apply';
import type { DemandPeriod } from './parse';

const P = (from: string, to: string | null, rates: Record<string, number>): DemandPeriod =>
  ({ effectiveFrom: new Date(from), effectiveTo: to ? new Date(to) : null, exportRates: rates });

describe('buildDemandRows', () => {
  it('chain window cho kỳ NEW (effectiveTo=null) nối tới from kỳ kế; kỳ mới nhất null', () => {
    const { rows } = buildDemandRows([
      P('2026-03-01', null, { israel: 28400 }),
      P('2026-06-18', null, { israel: 28400 }),
    ]);
    const il = rows.filter((r) => r.regionKey === 'israel');
    expect(il[0].endsAt?.toISOString()).toBe(new Date('2026-06-18').toISOString());
    expect(il[1].endsAt).toBeNull();
  });

  it('kỳ OLD giữ effectiveTo; mỗi vùng>0 ra 1 row', () => {
    const { rows } = buildDemandRows([P('2025-07-21', '2025-09-22', { israel: 11200, europe: 5000 })]);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.regionKey === 'israel')!.countryCodes).toEqual(['IL']);
    expect(rows.find((r) => r.regionKey === 'israel')!.endsAt?.toISOString()).toBe(
      new Date('2025-09-22').toISOString(),
    );
  });

  it('clamp endsAt kỳ OLD khi effectiveTo vượt quá from kỳ kế (chống chồng cửa sổ)', () => {
    const { rows } = buildDemandRows([
      P('2025-07-21', '2025-12-31', { israel: 11200 }), // OLD effectiveTo vượt quá kỳ kế
      P('2025-09-01', null, { israel: 28400 }),
    ]);
    const il = rows.filter((r) => r.regionKey === 'israel');
    expect(il[0].endsAt?.toISOString()).toBe(new Date('2025-09-01').toISOString());
    expect(il[1].endsAt).toBeNull();
  });

  it('vùng không map → unmappedRegions, không tạo row', () => {
    const { rows, unmappedRegions } = buildDemandRows([P('2026-01-01', null, { israel: 1, narnia: 2 })]);
    expect(rows).toHaveLength(1);
    expect(unmappedRegions).toContain('narnia');
  });
});
