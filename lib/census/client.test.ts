import { describe, expect, it } from 'vitest';
import { buildCensusUrl, parseCensusMatch } from './client';

describe('buildCensusUrl', () => {
  it('encode địa chỉ + benchmark + format', () => {
    const u = buildCensusUrl('28014 Harper Meadow Lane, Fulshear, TX 77441');
    expect(u).toContain('geocoding.geo.census.gov/geocoder/locations/onelineaddress');
    expect(u).toContain('benchmark=Public_AR_Current');
    expect(u).toContain('format=json');
    expect(u).toContain('address=28014%20Harper%20Meadow%20Lane%2C%20Fulshear%2C%20TX%2077441');
  });
});

describe('parseCensusMatch', () => {
  it('có match → matched true + matchedAddress', () => {
    const r = parseCensusMatch({ result: { addressMatches: [{ matchedAddress: '28014 HARPER MEADOW LN, FULSHEAR, TX, 77441' }] } });
    expect(r.matched).toBe(true);
    expect(r.matchedAddress).toBe('28014 HARPER MEADOW LN, FULSHEAR, TX, 77441');
  });
  it('không match → matched false', () => {
    expect(parseCensusMatch({ result: { addressMatches: [] } })).toEqual({ matched: false, matchedAddress: null });
  });
  it('raw lỗi/thiếu → matched false', () => {
    expect(parseCensusMatch(null)).toEqual({ matched: false, matchedAddress: null });
    expect(parseCensusMatch({})).toEqual({ matched: false, matchedAddress: null });
  });
});
