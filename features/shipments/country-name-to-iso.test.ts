import { describe, it, expect } from 'vitest';
import { countryNameToIso } from './country-name-to-iso';

describe('countryNameToIso', () => {
  it('returns null for blank input', () => {
    expect(countryNameToIso(null)).toBeNull();
    expect(countryNameToIso(undefined)).toBeNull();
    expect(countryNameToIso('')).toBeNull();
    expect(countryNameToIso('   ')).toBeNull();
  });

  it('passes through ISO-2 codes as-is', () => {
    expect(countryNameToIso('US')).toBe('US');
    expect(countryNameToIso('SA')).toBe('SA');
    expect(countryNameToIso('AE')).toBe('AE');
    expect(countryNameToIso('au')).toBe('AU'); // upper-case the result
    expect(countryNameToIso(' qa ')).toBe('QA');
  });

  it('looks up English country names from the Excel top-of-distribution', () => {
    expect(countryNameToIso('Saudi Arabia')).toBe('SA');
    expect(countryNameToIso('United States')).toBe('US');
    expect(countryNameToIso('united kingdom')).toBe('GB'); // case-insensitive
    expect(countryNameToIso('Hong Kong')).toBe('HK');
    expect(countryNameToIso('Vietnam')).toBe('VN');
  });

  it("collapses formula-busted 'X,X,X' values to the first segment", () => {
    // Real Excel data has these from a copy-down formula failure.
    expect(countryNameToIso('Saudi Arabia,Saudi Arabia')).toBe('SA');
    expect(countryNameToIso('United States,United States,United States')).toBe('US');
    expect(countryNameToIso('Qatar,Qatar')).toBe('QA');
  });

  it('handles variant English spellings', () => {
    expect(countryNameToIso('Korea')).toBe('KR');
    expect(countryNameToIso('South Korea')).toBe('KR');
    expect(countryNameToIso('Republic of Korea')).toBe('KR');
    expect(countryNameToIso('Macao')).toBe('MO');
    expect(countryNameToIso('Macau')).toBe('MO');
    expect(countryNameToIso('Türkiye')).toBe('TR');
    expect(countryNameToIso('Turkey')).toBe('TR');
  });

  it('returns null for unknown names so the importer can surface them', () => {
    expect(countryNameToIso('Wakanda')).toBeNull();
    expect(countryNameToIso('???')).toBeNull();
    // 3+ letter codes that LOOK ISO-ish but aren't ISO-2 also return null
    expect(countryNameToIso('USA')).toBeNull();
    expect(countryNameToIso('UAE')).toBeNull();
  });
});
