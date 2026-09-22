/**
 * Kiện trong SMS mà dòng LOG-Export trên Lark KHÔNG CÒN (Ops xoá dòng).
 *
 * Sync Lark là một chiều và không bao giờ xoá dữ liệu — một lỗi lập trình không được phép
 * quét sạch bảng vận hành. Hệ quả: dòng bị xoá trên Lark thì kiện vẫn nằm lại trong SMS và
 * vẫn hiện trên màn Đóng hàng như việc phải làm (CEO hỏi về #MBLVD29915 / PK-21357).
 *
 * Nên đánh dấu chứ không xoá: giữ lịch sử kiện, chỉ ẩn khỏi việc đang làm.
 */

/** Tỉ lệ tối thiểu số dòng Lark đọc được so với số kiện đang có, để dám kết luận "đã xoá". */
export const NGUONG_AN_TOAN = 0.8;

export interface KetQuaSoatMatDong {
  /** Log code của kiện cần đánh dấu là mất dòng Lark. */
  canDanhDau: string[];
  /** Log code của kiện từng bị đánh dấu nhưng dòng Lark đã quay lại. */
  canGoDanhDau: string[];
  /** Bỏ soát vì số dòng Lark đọc được quá ít so với số kiện — nghi Lark trả thiếu. */
  boQua: boolean;
}

/**
 * THUẦN: so tập log code trên Lark với tập log code trong SMS.
 *
 * GUARD: Lark trả thiếu (lỗi phân trang, quyền đổi, view lọc) thì cả nghìn kiện sẽ bị coi là
 * đã xoá. Nên chỉ soát khi số dòng đọc được còn ít nhất 80% số kiện đang có — thà bỏ một
 * lượt soát còn hơn đánh dấu sai hàng loạt.
 */
export function soatMatDong(
  logCodeTrenLark: readonly string[],
  kienTrongSms: ReadonlyArray<{ logUniqueCode: string; daDanhDau: boolean }>,
  nguong = NGUONG_AN_TOAN,
): KetQuaSoatMatDong {
  const rong: KetQuaSoatMatDong = { canDanhDau: [], canGoDanhDau: [], boQua: true };
  if (kienTrongSms.length === 0) return { ...rong, boQua: false };
  if (logCodeTrenLark.length < kienTrongSms.length * nguong) return rong;

  const tren = new Set(logCodeTrenLark);
  const canDanhDau: string[] = [];
  const canGoDanhDau: string[] = [];
  for (const k of kienTrongSms) {
    const con = tren.has(k.logUniqueCode);
    if (!con && !k.daDanhDau) canDanhDau.push(k.logUniqueCode);
    if (con && k.daDanhDau) canGoDanhDau.push(k.logUniqueCode);
  }
  return { canDanhDau, canGoDanhDau, boQua: false };
}
