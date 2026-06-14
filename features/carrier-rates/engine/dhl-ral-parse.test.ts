import { describe, it, expect } from 'vitest';
import { classifyLine } from './dhl-ral-parse';

describe('classifyLine (DHL RAL line parser)', () => {
  it('single JP postcode → stripped (matches engine alphanumeric key)', () => {
    expect(classifyLine('001-0000')).toEqual({ kind: 'postcode', value: '0010000' });
  });

  it('JP hyphenated range expands over the numeric suffix', () => {
    const r = classifyLine('001-0010 - 001-0040');
    expect(r.kind).toBe('range');
    if (r.kind === 'range') {
      expect(r.values[0]).toBe('0010010');
      expect(r.values.at(-1)).toBe('0010040');
      expect(r.values).toContain('0010025');
      expect(r.values.length).toBe(31);
    }
  });

  it('bare 3-digit prefix classifies as a (short) postcode — caller drops len<4', () => {
    expect(classifyLine('104')).toEqual({ kind: 'postcode', value: '104' });
    expect((classifyLine('104') as { value: string }).value.length).toBeLessThan(4);
  });

  it('PT/PL single-hyphen postcode kept as one code (not a range)', () => {
    expect(classifyLine('5000-289')).toEqual({ kind: 'postcode', value: '5000289' });
    expect(classifyLine('62-023')).toEqual({ kind: 'postcode', value: '62023' });
  });

  it('alphanumeric (UK) postcode stripped', () => {
    expect(classifyLine('SW1A 1AA')).toEqual({ kind: 'postcode', value: 'SW1A1AA' });
  });

  it('town (no digits) normalised uppercase alphanumeric', () => {
    expect(classifyLine('Al Batha Customs')).toEqual({ kind: 'town', value: 'ALBATHACUSTOMS' });
    expect(classifyLine('Sabt El Alaya')).toEqual({ kind: 'town', value: 'SABTELALAYA' });
  });

  it('plain numeric range (no internal hyphen) expands', () => {
    const r = classifyLine('98077 - 98079');
    expect(r.kind).toBe('range');
    if (r.kind === 'range') expect(r.values).toEqual(['98077', '98078', '98079']);
  });
});
