/**
 * Tên hãng vận chuyển ĐÚNG như bảng Lark logistics đang dùng ở cột "Couriers".
 *
 * Cột này là danh sách chọn — ghi một giá trị lạ thì Lark hoặc từ chối, hoặc tệ
 * hơn là đẻ ra lựa chọn mới làm loạn bộ lọc/thống kê của bên vận hành. Nên bảng
 * map phải khớp CHÍNH XÁC giá trị đang có (khảo sát 4.048 record ngày 04/09:
 * FedEx 2.483 · DHL 1.240 · ViettelPost 153 · HNC Aramex 89 · UPS 10 · ShunFeng 9).
 */
const MAP: Record<string, string> = {
  fedex: 'FedEx',
  dhl: 'DHL',
  aramex: 'HNC Aramex',
  ups: 'UPS',
  'sf-express': 'ShunFeng',
};

/** Khoá hãng trong hệ thống → tên trên Lark. Không map được → null (KHÔNG đoán). */
export function tenCourierLark(carrierKey: string | null | undefined): string | null {
  if (!carrierKey) return null;
  return MAP[carrierKey.trim().toLowerCase()] ?? null;
}

export const COURIER_KEYS_CO_MAP: readonly string[] = Object.keys(MAP);
