/**
 * Nước áp phí residential FedEx (theo residential_fixed.country_codes = US/CA).
 * Pha 1: mặc định coi đơn tới US/CA là nhà dân (67–85% đơn US/CA là residential —
 * khớp checkout-rates.ts:32 & push/recalc.ts:152). Pha 2 (FedEx Address Validation)
 * sẽ chính xác từng địa chỉ khi MMP gửi street.
 */
export const RESIDENTIAL_DEFAULT_COUNTRIES = ['US', 'CA'] as const;

export function isDefaultResidential(country: string): boolean {
  return (RESIDENTIAL_DEFAULT_COUNTRIES as readonly string[]).includes(country.trim().toUpperCase());
}
