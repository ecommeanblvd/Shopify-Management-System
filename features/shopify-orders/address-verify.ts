import type { AddressInput } from '@/lib/fedex/address';

export interface OrderAddressFields {
  shipAddress1: string | null; shipAddress2: string | null;
  shipCity: string | null; shipProvinceCode: string | null;
  shipPostcode: string | null; shipCountry: string | null;
}

/** THUẦN: map field địa chỉ đơn → AddressInput. null khi thiếu street1/country. */
export function buildAddressInput(o: OrderAddressFields): AddressInput | null {
  if (!o.shipAddress1 || !o.shipCountry) return null;
  const streetLines = [o.shipAddress1, o.shipAddress2 ?? '']
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return {
    streetLines,
    city: o.shipCity,
    stateOrProvinceCode: o.shipProvinceCode,
    postalCode: o.shipPostcode,
    countryCode: o.shipCountry,
  };
}
