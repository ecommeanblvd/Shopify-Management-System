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

/**
 * Nước FedEx MIỄN Direct Signature (không thu phí) — PHẢI khớp
 * `excluded_country_codes` của surcharge DS trên account FedEx. Trước đây
 * availability list có SA/IL/LU/CZ trong khi surcharge lại miễn chúng → mâu
 * thuẫn "hiện toggle nhưng không cộng phí" (bug MMP báo 08/07). Trừ tập này khỏi
 * availability để available=false ⇒ MMP ẩn toggle, khớp thực tế FedEx không thu.
 */
export const DIRECT_SIGNATURE_EXEMPT_COUNTRIES: string[] = [
  'SA', 'QA', 'IL', 'IQ', 'OM', 'KZ', 'JO', 'MC', 'LU', 'CY', 'CZ', 'PE', 'AO',
];

const SET = new Set(FEDEX_DIRECT_SIGNATURE_COUNTRIES);
const EXEMPT = new Set(DIRECT_SIGNATURE_EXEMPT_COUNTRIES);
export function countrySupportsDirectSignature(iso: string): boolean {
  const u = iso.trim().toUpperCase();
  return SET.has(u) && !EXEMPT.has(u);
}

/** THUẦN: brand có muốn DS và nước đích có hỗ trợ không → mới tính phí. */
export function shouldChargeDirectSignature(wantDS: boolean, country: string): boolean {
  return wantDS && countrySupportsDirectSignature(country);
}
