/**
 * Nước FedEx nhận Direct Signature Service. FedEx không công bố list máy-đọc
 * ("60+ nước, tự cập nhật") → allowlist tĩnh seed từ thị trường shop đang ship +
 * nước lớn có Signature Options; operator sửa 1 dòng khi cần.
 */
export const DIRECT_SIGNATURE_FEE_VND = 92700;

export const FEDEX_DIRECT_SIGNATURE_COUNTRIES: string[] = [
  'US', 'CA', 'MX',
  'GB', 'IE', 'FR', 'DE', 'NL', 'BE', 'LU', 'AT', 'CH', 'IT', 'ES', 'PT',
  'DK', 'SE', 'NO', 'FI', 'PL', 'CZ', 'HU', 'RO', 'GR',
  'AU', 'NZ', 'JP', 'KR', 'SG', 'HK', 'TW', 'MY', 'TH', 'PH', 'ID', 'IN', 'CN',
  'AE', 'SA', 'IL', 'ZA', 'BR',
];

const SET = new Set(FEDEX_DIRECT_SIGNATURE_COUNTRIES);
export function countrySupportsDirectSignature(iso: string): boolean {
  return SET.has(iso.trim().toUpperCase());
}
