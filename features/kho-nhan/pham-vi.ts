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
