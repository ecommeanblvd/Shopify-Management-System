import { describe, expect, it } from 'vitest';
import { regionToCountries } from './regions';

describe('regionToCountries', () => {
  it('maps israel to a single ISO code', () => {
    expect(regionToCountries('israel')).toEqual(['IL']);
  });

  it('maps meisa to a list including key Middle-East / South-Asia codes', () => {
    const codes = regionToCountries('meisa');
    expect(codes).toContain('SA');
    expect(codes).toContain('IQ');
    expect(codes).toContain('AE');
  });

  it('maps europe to a list including DE, FR, UA', () => {
    const codes = regionToCountries('europe');
    expect(codes).toContain('DE');
    expect(codes).toContain('FR');
    expect(codes).toContain('UA');
  });

  it('returns an empty array for an unknown region key', () => {
    expect(regionToCountries('bogus')).toEqual([]);
  });
});
