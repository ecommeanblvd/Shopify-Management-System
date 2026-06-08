import { describe, it, expect } from 'vitest';
import { matchCountryToZone, type SearchableZone } from './country-search-match';

const ZONES: SearchableZone[] = [
  { id: 'z1', label: 'Zone 1', countries: ['VN', 'TH'] },
  { id: 'z2', label: 'Zone 2', countries: ['SG', 'MY'] },
  { id: 'z3', label: 'Zone 3', countries: ['JP', 'KR'] },
];

describe('matchCountryToZone', () => {
  it('returns null for empty query', () => {
    expect(matchCountryToZone('', ZONES)).toBeNull();
    expect(matchCountryToZone('   ', ZONES)).toBeNull();
  });

  it('matches by ISO-2 code, case-insensitive', () => {
    expect(matchCountryToZone('jp', ZONES)).toEqual({
      code: 'JP', zoneId: 'z3', zoneLabel: 'Zone 3', name: 'Japan', otherCount: 0,
    });
  });

  it('matches by country name substring, case-insensitive', () => {
    const r = matchCountryToZone('japa', ZONES);
    expect(r?.code).toBe('JP');
    expect(r?.zoneId).toBe('z3');
  });

  it('returns null when no country matches', () => {
    expect(matchCountryToZone('atlantis', ZONES)).toBeNull();
  });

  it('reports otherCount when multiple countries match the name query', () => {
    const zones: SearchableZone[] = [
      { id: 'a', label: 'A', countries: ['US'] }, // United States
      { id: 'b', label: 'B', countries: ['GB'] }, // United Kingdom
    ];
    const r = matchCountryToZone('united', zones);
    expect(r).not.toBeNull();
    expect(r?.otherCount).toBe(1); // one match returned, one extra
  });

  it('prefers an exact ISO-2 match over a name substring match', () => {
    const r = matchCountryToZone('MY', ZONES);
    expect(r?.code).toBe('MY');
    expect(r?.zoneId).toBe('z2');
  });
});
