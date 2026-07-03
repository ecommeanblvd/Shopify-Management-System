import { describe, it, expect } from 'vitest';
import { COUNTRIES, dialCodeFor, countryByIso } from './countries';

describe('COUNTRIES dataset', () => {
  it('đủ ~250 nước, mỗi entry có iso2 (2 chữ hoa) + name + dialCode', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(240);
    for (const c of COUNTRIES) {
      expect(c.iso2).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.dialCode).toMatch(/^[0-9]{1,4}$/);
    }
  });
  it('iso2 không trùng', () => {
    const set = new Set(COUNTRIES.map((c) => c.iso2));
    expect(set.size).toBe(COUNTRIES.length);
  });
  it('có các nước MEAN hay ship + dial đúng', () => {
    expect(dialCodeFor('US')).toBe('1');
    expect(dialCodeFor('VN')).toBe('84');
    expect(dialCodeFor('GB')).toBe('44');
    expect(dialCodeFor('SA')).toBe('966');
    expect(dialCodeFor('AE')).toBe('971');
    expect(dialCodeFor('AU')).toBe('61');
    expect(dialCodeFor('JP')).toBe('81');
  });
});

describe('dialCodeFor / countryByIso', () => {
  it('không phân biệt hoa thường', () => {
    expect(dialCodeFor('us')).toBe('1');
    expect(countryByIso('vn')?.name).toBeTruthy();
  });
  it('iso2 lạ → null', () => {
    expect(dialCodeFor('ZZ')).toBeNull();
    expect(countryByIso('ZZ')).toBeNull();
  });
});
