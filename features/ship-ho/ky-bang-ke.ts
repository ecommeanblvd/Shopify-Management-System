/**
 * THUẦN: chia kỳ và quyết định gom cho bảng kê ship-hộ tự động (CEO 28/09/2026).
 *
 * Mốc kỳ KHÔNG đổi so với quyết định 22/09: kỳ tính theo ngày lần đẩy ĐẦU TIÊN
 * của `order.reconciled` sang MMP — tức lúc Đức đối soát xong và chốt giá thu.
 * Việc thêm ở đây chỉ là CHẠY TỰ ĐỘNG: trước nay `generateStatement` chỉ có nút
 * bấm tay trên màn Bảng kê, nên đơn đã chốt giá nằm chờ vô thời hạn (đo 28/09:
 * Kalisa còn 94 đơn chưa kê, 217.817.423đ).
 */

/** Kỳ THÁNG theo lịch VN của một thời điểm. */
export function kyThang(now: Date): { dau: string; cuoi: string; ten: string } {
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const y = vn.getUTCFullYear(), m = vn.getUTCMonth();
  const hai = (n: number) => String(n).padStart(2, '0');
  const cuoi = new Date(Date.UTC(y, m + 1, 0));
  return {
    dau: `${y}-${hai(m + 1)}-01`,
    cuoi: `${cuoi.getUTCFullYear()}-${hai(cuoi.getUTCMonth() + 1)}-${hai(cuoi.getUTCDate())}`,
    ten: `${y}-${hai(m + 1)}`,
  };
}

export type ViecGom = 'tao_moi' | 'them_vao_nhap' | 'bo_qua_da_chot';

/**
 * Bảng kê của kỳ này đang ở trạng thái nào thì làm gì.
 *
 * `issued`/`paid` → BỎ QUA: số đã gửi brand phải đứng yên, đơn về muộn sang kỳ
 * sau. Đây cũng là lý do lệnh tự động KHÔNG được tự chốt kỳ (CEO 28/09: máy tạo
 * bản nháp, người bấm chốt).
 */
export function viecGom(trangThaiDaCo: string | null | undefined): ViecGom {
  if (trangThaiDaCo == null) return 'tao_moi';
  return trangThaiDaCo === 'draft' ? 'them_vao_nhap' : 'bo_qua_da_chot';
}
