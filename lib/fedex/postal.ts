/**
 * Postcode đại diện cho nước mà dữ liệu địa chỉ KHÔNG có postcode (Vùng Vịnh…).
 * FedEx Rate API bắt buộc postalCode (NotNull) kể cả các nước này; vùng/demand
 * của chúng theo cấp quốc gia nên postcode thủ đô vẫn cho quote đúng (city gửi
 * kèm để phân giải vùng xa). Mỗi mã đã verify trả quote hợp lệ qua API thật.
 * Pure — không I/O, để unit-test.
 */
export const FALLBACK_POSTAL: Record<string, string> = {
  QA: '00974', AE: '00000', SA: '11564', KW: '13001',
  HK: '999077', BH: '00973', NG: '100001', JO: '11118', AO: '00000',
};

/** Postcode hiệu lực để quote: ưu tiên postcode thật, fallback theo nước.
 *  null khi không có cả hai (không quote được). */
export function effectivePostcode(country: string, postcode: string | null): string | null {
  if (postcode && postcode.trim()) return postcode.trim();
  return FALLBACK_POSTAL[country] ?? null;
}
