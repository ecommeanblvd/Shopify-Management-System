/**
 * Ghép cặp bảng kê ↔ hoá đơn trong cùng một lần tải file.
 *
 * Tách riêng khỏi phần đọc file để test được: người dùng có thể tải một cặp,
 * nhiều cặp của nhiều kỳ, hoặc thiếu một bên.
 */
export interface CoTong { tong: number }

export interface KetQuaGhepCap<B extends CoTong, H extends CoTong> {
  cap: Array<{ bangKe: B; hoaDon: H | null }>;
  /** Hoá đơn không có bảng kê đi kèm — xử lý theo đường cũ (chỉ có tổng mỗi vận đơn). */
  hoaDonThua: H[];
  warnings: string[];
}

export function ghepCapBangKeHoaDon<B extends CoTong, H extends CoTong>(
  bangKes: readonly B[],
  hoaDons: readonly H[],
): KetQuaGhepCap<B, H> {
  const warnings: string[] = [];
  const conLai = [...hoaDons];
  const cap: Array<{ bangKe: B; hoaDon: H | null }> = [];

  for (const bangKe of bangKes) {
    const i = conLai.findIndex((h) => h.tong === bangKe.tong);
    if (i >= 0) {
      cap.push({ bangKe, hoaDon: conLai[i] });
      conLai.splice(i, 1);
      continue;
    }
    // Đúng một bảng kê + một hoá đơn mà tổng lệch: gần như chắc chắn vẫn là
    // một bộ (lệch do một file thuộc kỳ khác). Ghép rồi báo, còn hơn chặn lại
    // để người dùng loay hoay không hiểu vì sao không nhập được.
    if (bangKes.length === 1 && conLai.length === 1) {
      warnings.push(`Tổng thanh toán của bảng kê và hoá đơn lệch nhau (${bangKe.tong.toLocaleString('vi-VN')}₫ vs ${conLai[0].tong.toLocaleString('vi-VN')}₫) — kiểm tra hai file có cùng một kỳ không.`);
      cap.push({ bangKe, hoaDon: conLai[0] });
      conLai.length = 0;
      continue;
    }
    cap.push({ bangKe, hoaDon: null });
  }

  return { cap, hoaDonThua: conLai, warnings };
}
