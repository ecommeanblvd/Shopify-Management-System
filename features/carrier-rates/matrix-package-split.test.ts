import { describe, it, expect } from 'vitest';
import { splitPackageCells, type RawMatrixCell } from './matrix-package-split';

const cell = (zoneId: string, tierId: string, packageType: 'pak' | 'package', cost: string): RawMatrixCell =>
  ({ zoneId, tierId, costAmount: cost, updatedAt: null, packageType });

describe('splitPackageCells', () => {
  it('tách package vs pak, gom pakTierIds duy nhất theo thứ tự', () => {
    const r = splitPackageCells([
      cell('z1', 't05', 'package', '39.33'),
      cell('z1', 't05', 'pak', '33.86'),
      cell('z1', 't1', 'pak', '41.90'),
      cell('z2', 't05', 'pak', '40.00'),
      cell('z1', 't3', 'package', '73.17'),
    ]);
    expect(r.packageCells.map((c) => [c.zoneId, c.tierId])).toEqual([['z1', 't05'], ['z1', 't3']]);
    expect(r.pakCells.map((c) => [c.zoneId, c.tierId, c.costAmount])).toEqual([
      ['z1', 't05', '33.86'], ['z1', 't1', '41.90'], ['z2', 't05', '40.00'],
    ]);
    // t05 xuất hiện ở cả z1 và z2 nhưng chỉ liệt kê 1 lần; thứ tự gặp đầu: t05, t1
    expect(r.pakTierIds).toEqual(['t05', 't1']);
  });

  it('không có pak → pakCells/pakTierIds rỗng', () => {
    const r = splitPackageCells([cell('z1', 't1', 'package', '10')]);
    expect(r.pakCells).toEqual([]);
    expect(r.pakTierIds).toEqual([]);
    expect(r.packageCells).toHaveLength(1);
  });
});
