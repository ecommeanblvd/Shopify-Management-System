/**
 * THUẦN: đơn này có được GIỮ HÀNG trên kệ không (CEO 30/09/2026).
 *
 * Vì sao cần: lượt nạp 3.238 đơn lịch sử 2025 hôm 30/09 đã khiến hệ thống **giữ 55 món hàng
 * thật trên kệ cho những đơn đã giao xong từ 2024–2025**. Hàng vẫn nằm đó nhưng bị đánh dấu
 * "đã có người mua, đừng bán", và mọi màn tính "hàng khả dụng = tồn − đang giữ" đều thấy thiếu.
 *
 * Gốc: `allocateOrder` đã có chốt cho đơn HUỶ nhưng KHÔNG có chốt cho đơn ĐÃ GIAO. Đơn mới và
 * đơn năm ngoái đi qua đúng một đường.
 *
 * Nó sẽ lặp lại ở MỌI lượt nạp lịch sử sau này — CEO vừa nối store HC và có thể nối thêm store
 * khác — nên chốt phải nằm ở mã, không phải ở việc nhớ dọn tay sau mỗi lượt.
 */

/** Đơn đã giao xong bên Shopify. Đo production 30/09: 12.001 đơn ở trạng thái này. */
export const DA_GIAO = 'FULFILLED';

/**
 * Có giữ hàng cho đơn này không.
 *
 * `PARTIALLY_FULFILLED` (126 đơn) VẪN GIỮ: mới đi một phần, phần còn lại vẫn phải bốc. Chặn cả
 * ca này là làm kho không lấy được hàng cho phần chưa đi — hỏng việc thật để chữa một việc ảo.
 *
 * Trạng thái lạ hoặc rỗng thì VẪN GIỮ: không biết chắc đã giao thì cứ giữ, vì bỏ sót một đơn
 * đang chờ bốc tốn kém hơn giữ oan một món — giữ oan thì nhả ra được, còn hàng bị đơn khác lấy
 * mất thì phải đi mua lại.
 */
export function nenGiuHang(
  trangThaiGiao: string | null | undefined,
  daHuyLuc: Date | string | null | undefined,
): boolean {
  if (daHuyLuc != null) return false;                       // giữ nguyên luật cũ cho đơn huỷ
  return (trangThaiGiao ?? '').trim().toUpperCase() !== DA_GIAO;
}

/**
 * Trạng thái KHỞI ĐẦU cho một bản ghi fulfillment vừa tạo.
 *
 * Đơn đã giao xong bên Shopify thì hồ sơ bên mình phải mở ở `shipped`, KHÔNG phải `received`.
 * `received` là một HÀNG ĐỢI VIỆC: lượt nạp lịch sử 30/09 đẩy 19 đơn đã giao vào đó và 16 đơn
 * vào `ready_to_pick`, nên kho mở màn ra thấy việc phải bốc hàng cho đơn năm ngoái.
 *
 * Đơn huỷ vẫn mở ở `received` như cũ: nó không phải hàng đã đi, và luồng huỷ có đường xử lý
 * riêng — đổi ở đây là đụng vào thứ không hỏng.
 */
export function trangThaiMoHoSo(trangThaiGiao: string | null | undefined): 'received' | 'shipped' {
  return (trangThaiGiao ?? '').trim().toUpperCase() === DA_GIAO ? 'shipped' : 'received';
}

/** Trạng thái khởi đầu cho DÒNG đơn — cùng lý do. `pending_check` là thứ bộ cấp hàng đi tìm. */
export function trangThaiMoDong(trangThaiGiao: string | null | undefined): 'pending_check' | 'shipped' {
  return (trangThaiGiao ?? '').trim().toUpperCase() === DA_GIAO ? 'shipped' : 'pending_check';
}
