import { describe, it, expect } from 'vitest';
import { buildAddressInput } from './address-verify';

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
