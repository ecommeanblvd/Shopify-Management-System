import { describe, expect, it } from 'vitest';
import { COMPARE_WEIGHT_GRID } from './weight-grid';

describe('COMPARE_WEIGHT_GRID', () => {
  it('40 mốc 0.5→20kg bước 0.5', () => {
    expect(COMPARE_WEIGHT_GRID).toHaveLength(40);
    expect(COMPARE_WEIGHT_GRID[0]).toBe(0.5);
    expect(COMPARE_WEIGHT_GRID[COMPARE_WEIGHT_GRID.length - 1]).toBe(20);
    expect(COMPARE_WEIGHT_GRID[1] - COMPARE_WEIGHT_GRID[0]).toBeCloseTo(0.5);
  });
});
