import { describe, it, expect } from 'vitest';
import { CITIES_BY_ISO, citiesFor } from './cities';

describe('citiesFor', () => {
  it('nước đã curate → list không rỗng (vd US có New York)', () => {
    const us = citiesFor('US');
    expect(us.length).toBeGreaterThan(5);
    expect(us).toContain('New York');
  });
  it('không phân biệt hoa thường', () => {
    expect(citiesFor('us').length).toBe(citiesFor('US').length);
  });
  it('nước chưa curate → mảng rỗng (không lỗi)', () => {
    expect(citiesFor('ZZ')).toEqual([]);
  });
  it('mọi list đều là string không rỗng, không trùng trong 1 nước', () => {
    for (const [iso, list] of Object.entries(CITIES_BY_ISO)) {
      expect(iso).toMatch(/^[A-Z]{2}$/);
      expect(new Set(list).size).toBe(list.length);
      for (const c of list) expect(c.trim().length).toBeGreaterThan(0);
    }
  });
});
