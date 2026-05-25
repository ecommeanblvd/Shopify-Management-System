import { describe, it, expect } from 'vitest';
import { parsePostcodeCsv } from './postcodes-csv';

describe('parsePostcodeCsv', () => {
  it('parses a clean CSV with header', () => {
    const csv = ['country,postcode', 'VN,710000', 'VN,711000', 'TH,10100'].join('\n');
    const out = parsePostcodeCsv(csv);
    expect(out.warnings).toEqual([]);
    expect(out.rows).toEqual([
      { country: 'VN', pattern: '710000' },
      { country: 'VN', pattern: '711000' },
      { country: 'TH', pattern: '10100' },
    ]);
  });

  it('parses without header', () => {
    const csv = ['SG,018989', 'MY,50088'].join('\n');
    const out = parsePostcodeCsv(csv);
    expect(out.rows).toHaveLength(2);
    expect(out.warnings).toEqual([]);
  });

  it('uppercases country and skips comments / blanks', () => {
    const csv = ['# Source: DHL remote areas Q1', 'vn,710000', '', 'tH,10100'].join('\n');
    const out = parsePostcodeCsv(csv);
    expect(out.rows).toEqual([
      { country: 'VN', pattern: '710000' },
      { country: 'TH', pattern: '10100' },
    ]);
  });

  it('warns on invalid country and skips that row', () => {
    const csv = ['XYZ,12345', 'VN,67890'].join('\n');
    const out = parsePostcodeCsv(csv);
    expect(out.warnings.some((w) => w.includes('XYZ'))).toBe(true);
    expect(out.rows).toEqual([{ country: 'VN', pattern: '67890' }]);
  });

  it('warns and skips rows missing one column', () => {
    const csv = ['VN', 'TH,10100'].join('\n');
    const out = parsePostcodeCsv(csv);
    expect(out.warnings.length).toBe(1);
    expect(out.rows).toEqual([{ country: 'TH', pattern: '10100' }]);
  });

  it('collapses duplicates and emits a summary warning', () => {
    const csv = ['VN,710000', 'VN,710000', 'VN,710000', 'VN,711000'].join('\n');
    const out = parsePostcodeCsv(csv);
    expect(out.rows).toEqual([
      { country: 'VN', pattern: '710000' },
      { country: 'VN', pattern: '711000' },
    ]);
    expect(out.warnings.some((w) => /2 duplicate/.test(w))).toBe(true);
  });

  it('returns empty + warning for empty input', () => {
    expect(parsePostcodeCsv('')).toEqual({ rows: [], warnings: ['CSV is empty'] });
  });
});
