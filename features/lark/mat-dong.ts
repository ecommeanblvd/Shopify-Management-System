/**
 * Kiện trong SMS mà dòng LOG-Export trên Lark KHÔNG CÒN (Ops xoá dòng).
 *
 * Sync Lark là một chiều và không bao giờ xoá dữ liệu — một lỗi lập trình không được phép
 * quét sạch bảng vận hành. Hệ quả: dòng bị xoá trên Lark thì kiện vẫn nằm lại trong SMS và
 * vẫn hiện trên màn Đóng hàng như việc phải làm (CEO hỏi về #MBLVD29915 / PK-21357).
 *
 * Nên đánh dấu chứ không xoá: giữ lịch sử kiện, chỉ ẩn khỏi việc đang làm.
 */

/**
 * Trần số kiện được đánh dấu trong MỘT lượt sync.
 *
 * Không so theo tỉ lệ Lark/SMS: SMS tích luỹ nhiều hơn Lark (Lark dọn dòng cũ, kiện còn vào
 * từ hoá đơn hãng) — đo 22/09/2026 là 4.327 dòng Lark cho 6.051 kiện, tức 71%, nên mọi
 * ngưỡng tỉ lệ đều hoặc chặn oan hoặc vô dụng. Ops xoá vài dòng mỗi ngày; thấy hàng trăm
 * dòng biến mất cùng lúc thì gần như chắc chắn là Lark trả thiếu, không phải người xoá.
 * Đánh dấu hàng loạt cho dữ liệu cũ thì chạy script riêng với trần cao.
 */
export const TOI_DA_MOI_LUOT = 50;

export interface KetQuaSoatMatDong {
  /** Log code của kiện cần đánh dấu là mất dòng Lark. */
  canDanhDau: string[];
  /** Log code của kiện từng bị đánh dấu nhưng dòng Lark đã quay lại. */
  canGoDanhDau: string[];
  /** Bỏ soát vì số kiện phải đánh dấu vượt trần — nghi Lark trả thiếu chứ không phải người xoá. */
  boQua: boolean;
  /** Số kiện lẽ ra phải đánh dấu, dùng để báo trong log khi bỏ qua. */
  soPhatHien: number;
}

/**
 * THUẦN: so tập log code trên Lark với tập log code trong SMS.
 *
 * GUARD: Lark trả thiếu (lỗi phân trang, quyền đổi, view lọc) thì cả nghìn kiện sẽ bị coi là
 * đã xoá — nên vượt trần thì bỏ cả lượt, thà chậm một nhịp còn hơn đánh dấu sai hàng loạt.
 */
export function soatMatDong(
  logCodeTrenLark: readonly string[],
  kienTrongSms: ReadonlyArray<{ logUniqueCode: string; daDanhDau: boolean }>,
  toiDa = TOI_DA_MOI_LUOT,
): KetQuaSoatMatDong {
  const tren = new Set(logCodeTrenLark);
  const canDanhDau: string[] = [];
  const canGoDanhDau: string[] = [];
  for (const k of kienTrongSms) {
    const con = tren.has(k.logUniqueCode);
    if (!con && !k.daDanhDau) canDanhDau.push(k.logUniqueCode);
    if (con && k.daDanhDau) canGoDanhDau.push(k.logUniqueCode);
  }
  // Gỡ dấu thì luôn làm: dòng quay lại là tin tốt, không cần đề phòng.
  if (canDanhDau.length > toiDa) {
    return { canDanhDau: [], canGoDanhDau, boQua: true, soPhatHien: canDanhDau.length };
  }
  return { canDanhDau, canGoDanhDau, boQua: false, soPhatHien: canDanhDau.length };
}
