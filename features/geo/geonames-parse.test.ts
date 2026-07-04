import { describe, it, expect } from 'vitest';
import { normPostcode, normCity, parseGeonamesZipTsv } from './geonames-parse';

// Format GeoNames zip TSV (12 cột): country, postal, place, admin1name, admin1code,
// admin2name, admin2code, admin3name, admin3code, lat, lng, accuracy
const TSV = [
  'US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.0901\t-118.4065\t4',
  'US\t10001\tNew York\tNew York\tNY\tNew York\t061\t\t\t40.7484\t-73.9967\t4',
  'US\t90210\tBeverly Hills\tCalifornia\tCA\tLos Angeles\t037\t\t\t34.0901\t-118.4065\t4', // dup
  'US\tbad-line-thiếu-cột', // lỗi → skip
  'GB\tSW1A 1AA\tLondon\tEngland\tENG\t\t\t\t\t51.501\t-0.1416\t6', // country khác filter
].join('\n');

describe('norm', () => {
  it('postcode: upper + alnum', () => {
    expect(normPostcode('sw1a 1aa')).toBe('SW1A1AA');
    expect(normPostcode('90210-1234')).toBe('902101234');
  });
  it('city: upper + alnum', () => { expect(normCity('Beverly Hills')).toBe('BEVERLYHILLS'); });
});

describe('parseGeonamesZipTsv', () => {
  it('parse đúng cột, dedup, skip dòng lỗi, filter country', () => {
    const r = parseGeonamesZipTsv(TSV, 'US');
    expect(r.rows).toHaveLength(2); // dup bị loại
    expect(r.rows[0]).toMatchObject({
      countryCode: 'US', postcode: '90210', postcodeNorm: '90210',
      city: 'Beverly Hills', stateCode: 'CA', lat: '34.09010', lng: '-118.40650',
    });
    expect(r.skipped).toBe(1); // dòng lỗi
    expect(r.states).toEqual([
      { countryCode: 'US', code: 'CA', name: 'California' },
      { countryCode: 'US', code: 'NY', name: 'New York' },
    ]);
    expect(r.cities.map((c) => c.nameNorm)).toEqual(['BEVERLYHILLS', 'NEWYORK']);
  });
  it('admin1 code rỗng → stateCode null, vẫn nhận', () => {
    const r = parseGeonamesZipTsv('AE\t00000\tDubai\t\t\t\t\t\t\t25.2\t55.3\t4', 'AE');
    expect(r.rows[0].stateCode).toBeNull();
    expect(r.states).toHaveLength(0);
  });
});
