/**
 * THUẦN: lối ĐÓNG KIỆN khi kiện không bao giờ có vận đơn (CEO 28/09/2026).
 *
 * Màn Đóng hàng trước đây chỉ có MỘT lối ra: có mã vận đơn. Đo thật 28/09/2026
 * trên 14 kiện tồn quá 7 ngày thì 13 kiện KHÔNG PHẢI việc phải làm:
 *   • 11 kiện đơn Invalid (sai địa chỉ / khách không hợp tác) — không bao giờ đi;
 *   • 1 kiện giao tận tay tại văn phòng Giang Văn Minh (đơn MKT mượn quay video);
 *   • 1 kiện là dòng trùng — hàng thật đã đi bằng kiện anh em.
 * Chúng nằm lại vĩnh viễn, và cách duy nhất Ops dọn được là XOÁ dòng Lark — tức
 * xoá luôn hồ sơ thay vì đóng nó có lý do.
 *
 * Hai lối, cố ý khác nhau:
 *   1. TỰ ĐỘNG cho đơn Invalid — đọc từ Lark, không ai phải bấm, và TỰ QUAY LẠI
 *      hàng chờ khi CX sửa được địa chỉ và Lark bỏ cờ. Không sợ đóng nhầm.
 *   2. ĐÓNG TAY cho ba trường hợp còn lại — có lý do, có ghi chú, có dấu vết ai
 *      đóng lúc nào, và mở lại được.
 */

/* Đúng bằng chữ `Invalid`, KHÔNG dùng "có chứa": "Invalid address fixed" nghĩa
 * ngược hẳn, mà bắt bằng `includes` thì nó cũng dính. Cờ này ĐUỔI việc ra khỏi
 * hàng chờ nên nhận nhầm là giấu mất việc thật. */
export function laDonInvalid(remark: string | null | undefined): boolean {
  return (remark ?? '').trim().toLowerCase() === 'invalid';
}

export interface LyDoDong { ma: string; ten: string; }

/** Bốn lý do CEO chốt 28/09/2026. Thứ tự này là thứ tự hiện trên màn hình. */
export const LY_DO_DONG: readonly LyDoDong[] = [
  { ma: 'giao_tay', ten: 'Giao tận tay / tại văn phòng' },
  { ma: 'dong_trung', ten: 'Dòng trùng — kiện khác đã đi' },
  { ma: 'don_huy', ten: 'Đơn huỷ / không đi nữa' },
  { ma: 'khac', ten: 'Lý do khác' },
] as const;

export function lyDoDongHopLe(ma: string): boolean {
  return LY_DO_DONG.some((l) => l.ma === ma);
}

export function nhanLyDoDong(ma: string): string {
  return LY_DO_DONG.find((l) => l.ma === ma)?.ten ?? ma;
}

export interface DongKienVao {
  lyDo: string;
  ghiChu: string | null;
  /** Mã kiện đã đi thật — bắt buộc khi lý do là `dong_trung`. */
  kienThayThe: string | null;
}

/**
 * Kiểm đầu vào. Trả THÔNG ĐIỆP cụ thể chứ không chỉ true/false — người đóng cần
 * biết thiếu đúng cái gì. `maKienNay` để chặn tự chỉ về chính nó.
 */
export function kiemDongKien(v: DongKienVao, maKienNay?: string | null): string | null {
  if (!lyDoDongHopLe(v.lyDo)) return 'Lý do đóng không hợp lệ.';

  // "Khác" mà không ghi gì thì ba tháng sau không ai hiểu vì sao kiện biến mất.
  if (v.lyDo === 'khac' && !v.ghiChu?.trim()) {
    return 'Lý do "khác" bắt buộc có ghi chú.';
  }

  if (v.lyDo === 'dong_trung') {
    const ma = v.kienThayThe?.trim();
    if (!ma) return 'Chọn "dòng trùng" thì phải ghi mã kiện đã đi thật.';
    if (maKienNay && ma.toLowerCase() === maKienNay.trim().toLowerCase()) {
      return 'Kiện thay thế không thể là chính nó.';
    }
  }
  return null;
}
