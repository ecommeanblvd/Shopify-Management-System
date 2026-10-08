/**
 * THUẦN: store nào được nhận hàng ở màn Nhận & Kiểm hàng (CEO 29/09/2026).
 *
 * Trước 29/09 màn này KHÔNG lọc store — nó lấy mọi đơn chưa fulfill của mọi
 * store đã đồng bộ, nên `cici-mean` lọt vào cùng ba store vận hành thật. CEO
 * chốt chặn `cici-mean`.
 *
 * DANH SÁCH CHO PHÉP, không phải danh sách chặn. Hai kiểu hỏng khác nhau khi có
 * store mới đồng bộ về:
 *   - danh sách chặn → store mới TỰ LỌT vào màn nhập, không ai hay;
 *   - danh sách cho phép → store mới KHÔNG tìm thấy hàng, kho báo ngay.
 * Cái sai lộ ra được thì chọn; cái sai im lặng thì tránh — đúng bài học đã lặp
 * nhiều lần trong hai ngày 28–29/09.
 */

/** Khoá theo `shop_domain` vì tên store đổi được, domain thì không. */
export const STORE_NHAN_HANG: readonly string[] = [
  'meanblvd.myshopify.com',
  'tinhatelier.myshopify.com',
  'mirermirer-official.myshopify.com',
];

/** Store này có được nhận hàng không. Domain lạ → KHÔNG, không đoán. */
export function nhanHangDuoc(shopDomain: string | null | undefined): boolean {
  const d = shopDomain?.trim().toLowerCase();
  return !!d && STORE_NHAN_HANG.includes(d);
}

/**
 * THUẦN: kênh KHÔNG-SHOPIFY nào được nhận hàng qua bảng món Lark (CEO 08/10/2026).
 *
 * Bảo báo "không nhập được đơn TQ". Nguyên nhân: ô tìm chỉ đọc `shopify_orders` và bảng PO, mà
 * đơn Trung Quốc không nằm ở đâu trong hai chỗ đó — 0 đơn `MTB`/`MXHS` trong `shopify_orders`.
 * Chúng nằm ở bảng món (`lark_mon_don`), 211 dòng, cập nhật theo thời gian thật.
 *
 * CEO xác nhận ý nghĩa tiền tố 08/10/2026:
 *   #MTB  = MEAN Taobao
 *   #MXHS = MEAN Xiao Hong Shu
 *   #TA   = Tinh Atelier   → ĐÃ có đủ trong `shopify_orders` (646/646), không cần đường này
 *   #HC   = Happy Clothing → có trong SMS nhưng store cố ý ngoài `STORE_NHAN_HANG`
 *
 * CHỈ hai kênh Trung Quốc. Bảng món còn `MIRER` (253), `MCN` (70), `MOS` (52), `MER-` (88) —
 * tổng 463 dòng chưa rõ là kênh gì. Mở bừa là cho kho nhận hàng không ai duyệt; thêm kênh về
 * sau chỉ là thêm một dòng vào đây. Cùng lý lẽ "danh sách cho phép" như `STORE_NHAN_HANG`.
 */
export const STORE_MON_LARK: readonly string[] = ['#MTB', '#MXHS'];

/** Kênh này có được nhận qua bảng món Lark không. Giá trị lạ → KHÔNG, không đoán. */
export function nhanQuaMonLark(store: string | null | undefined): boolean {
  const s = store?.trim();
  return !!s && STORE_MON_LARK.includes(s);
}
