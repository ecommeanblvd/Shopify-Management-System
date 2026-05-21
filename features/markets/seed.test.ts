import { describe, it, expect } from 'vitest';
import { DEFAULT_MARKETS } from './seed';
import type { Market } from './types';

describe('DEFAULT_MARKETS seed', () => {
  it('contains exactly 11 markets', () => {
    expect(DEFAULT_MARKETS).toHaveLength(11);
  });

  it('contains expected handles', () => {
    const handles = DEFAULT_MARKETS.map((m) => m.handle).sort();
    expect(handles).toEqual([
      'canada', 'europe', 'greater-china', 'international', 'japan',
      'korea', 'middle-east', 'oceania', 'south-east-asia',
      'united-states', 'vietnam-domestic',
    ]);
  });

  it('has exactly one international market with empty countries', () => {
    const intl = DEFAULT_MARKETS.filter((m) => m.type === 'international');
    expect(intl).toHaveLength(1);
    expect(intl[0].countries).toEqual([]);
  });

  it('has no overlapping countries between regional markets', () => {
    const seen = new Map<string, string>();
    for (const m of DEFAULT_MARKETS.filter((x) => x.type === 'regional')) {
      for (const c of m.countries) {
        if (seen.has(c)) {
          throw new Error(`Country ${c} in both '${seen.get(c)}' and '${m.handle}'`);
        }
        seen.set(c, m.handle);
      }
    }
  });

  it('all country codes are valid ISO-2 (exactly 2 uppercase letters)', () => {
    for (const m of DEFAULT_MARKETS) {
      for (const c of m.countries) {
        expect(c).toMatch(/^[A-Z]{2}$/);
      }
    }
  });

  it('all handles are unique', () => {
    const set = new Set(DEFAULT_MARKETS.map((m) => m.handle));
    expect(set.size).toBe(DEFAULT_MARKETS.length);
  });

  it('every market has a non-empty primary currency and language', () => {
    for (const m of DEFAULT_MARKETS) {
      expect(m.primaryCurrency).toMatch(/^[A-Z]{3}$/);
      expect(m.primaryLanguage).toMatch(/^[a-z]{2}$/);
    }
  });
});
