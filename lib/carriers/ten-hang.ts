/**
 * Khoá hãng → tên hiển thị. MỘT chỗ duy nhất, vì trước đây mỗi màn tự gõ lại.
 *
 * Hãng chưa có trong bảng thì trả về chính khoá, viết hoa chữ đầu — thà hiện `sf-express`
 * còn hơn giấu mất một hãng có thật khỏi bộ lọc.
 */
const TEN: Record<string, string> = {
  fedex: 'FedEx',
  dhl: 'DHL',
  ups: 'UPS',
  aramex: 'Aramex',
  'sf-express': 'SF Express',
};

export function tenHang(khoa: string): string {
  return TEN[khoa] ?? (khoa.charAt(0).toUpperCase() + khoa.slice(1));
}
