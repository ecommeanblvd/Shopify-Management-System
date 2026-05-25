import { describe, it, expect } from 'vitest';
import { parseMatrixCsv } from './matrix-csv';

describe('parseMatrixCsv', () => {
  it('parses a clean matrix', () => {
    const csv = [
      ',Zone 1,Zone 2,Zone 3',
      '0.5,180000,210000,260000',
      '1.0,260000,310000,380000',
    ].join('\n');
    const out = parseMatrixCsv(csv);
    expect(out.warnings).toEqual([]);
    expect(out.zoneLabels).toEqual(['Zone 1', 'Zone 2', 'Zone 3']);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toEqual({
      upperKg: 0.5,
      rates: [
        { zoneLabel: 'Zone 1', cost: 180000 },
        { zoneLabel: 'Zone 2', cost: 210000 },
        { zoneLabel: 'Zone 3', cost: 260000 },
      ],
    });
    expect(out.rows[1].upperKg).toBe(1);
  });

  it('skips empty cells without warning', () => {
    const csv = [
      ',Zone 1,Zone 2',
      '1,300000,',
    ].join('\n');
    const out = parseMatrixCsv(csv);
    expect(out.rows[0].rates).toEqual([{ zoneLabel: 'Zone 1', cost: 300000 }]);
    expect(out.warnings).toEqual([]);
  });

  it('warns on invalid weight and skips the row', () => {
    const csv = [
      ',Zone 1',
      'abc,100000',
      '2,200000',
    ].join('\n');
    const out = parseMatrixCsv(csv);
    expect(out.warnings).toContain('Row 2: weight "abc" is not a positive number — skipped');
    expect(out.rows).toEqual([{ upperKg: 2, rates: [{ zoneLabel: 'Zone 1', cost: 200000 }] }]);
  });

  it('warns on invalid cost and skips that cell only', () => {
    const csv = [
      ',Zone 1,Zone 2',
      '1,not-a-number,250000',
    ].join('\n');
    const out = parseMatrixCsv(csv);
    expect(out.warnings.some((w) => w.includes('Zone 1'))).toBe(true);
    expect(out.rows[0].rates).toEqual([{ zoneLabel: 'Zone 2', cost: 250000 }]);
  });

  it('handles thousand-grouping commas in cost values', () => {
    const csv = [
      ',Zone 1',
      '1,180_000',
    ].join('\n');
    const out = parseMatrixCsv(csv);
    expect(out.rows[0].rates[0].cost).toBe(180000);
  });

  it('returns empty result with warning for empty CSV', () => {
    expect(parseMatrixCsv('')).toEqual({ zoneLabels: [], rows: [], warnings: ['CSV is empty'] });
  });
});
