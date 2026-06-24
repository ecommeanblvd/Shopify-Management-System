import { describe, it, expect } from 'vitest';
import { buildAddressInput, buildOneLine } from './address-verify';

describe('buildAddressInput', () => {
  const base = { shipAddress1: '12 Main St', shipAddress2: 'Apt 4', shipCity: 'LA', shipProvinceCode: 'CA', shipPostcode: '90001', shipCountry: 'US' };
  it('đủ field → AddressInput đầy đủ', () => {
    expect(buildAddressInput(base)).toEqual({
      streetLines: ['12 Main St', 'Apt 4'], city: 'LA', stateOrProvinceCode: 'CA', postalCode: '90001', countryCode: 'US',
    });
  });
  it('thiếu address2 → 1 dòng street', () => {
    expect(buildAddressInput({ ...base, shipAddress2: null })?.streetLines).toEqual(['12 Main St']);
  });
  it('address2 rỗng/space → bỏ', () => {
    expect(buildAddressInput({ ...base, shipAddress2: '   ' })?.streetLines).toEqual(['12 Main St']);
  });
  it('thiếu shipAddress1 → null', () => {
    expect(buildAddressInput({ ...base, shipAddress1: null })).toBeNull();
  });
  it('thiếu shipCountry → null', () => {
    expect(buildAddressInput({ ...base, shipCountry: null })).toBeNull();
  });
});

describe('buildOneLine', () => {
  it('ghép street + city + state(strip prefix) + zip', () => {
    expect(buildOneLine({
      shipAddress1: '28014 Harper Meadow Lane', shipAddress2: null,
      shipCity: 'Fulshear', shipProvinceCode: 'US-TX', shipPostcode: '77441', shipCountry: 'US',
    })).toBe('28014 Harper Meadow Lane, Fulshear, TX 77441');
  });
  it('gộp address2, bỏ phần rỗng', () => {
    expect(buildOneLine({
      shipAddress1: '1 Main St', shipAddress2: 'Apt 5',
      shipCity: 'Brooklyn', shipProvinceCode: 'NY', shipPostcode: '11228', shipCountry: 'US',
    })).toBe('1 Main St Apt 5, Brooklyn, NY 11228');
  });
});
