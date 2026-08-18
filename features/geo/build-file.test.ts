import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import {
  buildGeoCountryFile, buildGeoCountryFileFromParsed, gzipGeoCountryFile, groupPostcodeRows, rawCompare,
} from './build-file';
import type { GeoCityRow, GeoPostcodeRow } from './geonames-parse';

describe('rawCompare', () => {
  it('so sánh binary trên raw string, không phải localeCompare', () => {
    expect(rawCompare('A', 'B')).toBeLessThan(0);
    expect(rawCompare('B', 'A')).toBeGreaterThan(0);
    expect(rawCompare('A', 'A')).toBe(0);
  });
});

describe('groupPostcodeRows', () => {
  it('gộp theo postcodeNorm, giữ nguyên thứ tự city trong nhóm (không tự sort)', () => {
    const rows = [
      { postcodeNorm: '10001', city: 'Boston', stateCode: 'MA' },
      { postcodeNorm: '10001', city: 'Cambridge', stateCode: 'MA' },
      { postcodeNorm: '20002', city: 'Zurich', stateCode: null },
    ];
    expect(groupPostcodeRows(rows)).toEqual({
      '10001': [{ city: 'Boston', stateCode: 'MA' }, { city: 'Cambridge', stateCode: 'MA' }],
      '20002': [{ city: 'Zurich', stateCode: null }],
    });
  });
});

describe('buildGeoCountryFile', () => {
  it('dựng GeoCountryFile từ cities + postcodeRows đã đúng thứ tự', () => {
    const cities = [{ name: 'Austin', stateCode: 'TX' }, { name: 'Boston', stateCode: 'MA' }];
    const postcodeRows = [{ postcodeNorm: '10001', city: 'Boston', stateCode: 'MA' }];
    expect(buildGeoCountryFile(cities, postcodeRows)).toEqual({
      cities: [{ name: 'Austin', stateCode: 'TX' }, { name: 'Boston', stateCode: 'MA' }],
      postcodes: { '10001': [{ city: 'Boston', stateCode: 'MA' }] },
    });
  });
});

describe('buildGeoCountryFileFromParsed', () => {
  it('tự sort cities theo name asc (rawCompare) trước khi dựng file', () => {
    const cities: GeoCityRow[] = [
      { countryCode: 'US', stateCode: 'TX', name: 'Dallas', nameNorm: 'DALLAS' },
      { countryCode: 'US', stateCode: 'TX', name: 'Austin', nameNorm: 'AUSTIN' },
      { countryCode: 'US', stateCode: 'MA', name: 'Boston', nameNorm: 'BOSTON' },
    ];
    const rows: GeoPostcodeRow[] = [];
    const file = buildGeoCountryFileFromParsed(cities, rows);
    expect(file.cities.map((c) => c.name)).toEqual(['Austin', 'Boston', 'Dallas']);
  });

  it('tự sort postcode rows theo (postcodeNorm asc, city asc) rồi group', () => {
    const cities: GeoCityRow[] = [];
    const rows: GeoPostcodeRow[] = [
      { countryCode: 'US', postcode: '10001', postcodeNorm: '10001', city: 'Cambridge', stateCode: 'MA', lat: null, lng: null },
      { countryCode: 'US', postcode: '10001', postcodeNorm: '10001', city: 'Boston', stateCode: 'MA', lat: null, lng: null },
      { countryCode: 'US', postcode: '90210', postcodeNorm: '90210', city: 'Beverly Hills', stateCode: 'CA', lat: null, lng: null },
    ];
    const file = buildGeoCountryFileFromParsed(cities, rows);
    expect(file.postcodes).toEqual({
      '10001': [{ city: 'Boston', stateCode: 'MA' }, { city: 'Cambridge', stateCode: 'MA' }],
      '90210': [{ city: 'Beverly Hills', stateCode: 'CA' }],
    });
  });
});

describe('gzipGeoCountryFile', () => {
  it('gzip round-trip đúng JSON', () => {
    const file = { cities: [{ name: 'A', stateCode: null }], postcodes: {} };
    const gz = gzipGeoCountryFile(file);
    expect(JSON.parse(gunzipSync(gz).toString('utf-8'))).toEqual(file);
  });
});
