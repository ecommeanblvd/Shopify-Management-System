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
 * CHỈ hai kênh Trung Quốc. Cùng lý lẽ "danh sách cho phép" như `STORE_NHAN_HANG`: thêm kênh về
 * sau là thêm một dòng vào đây, còn mở bừa là cho kho nhận hàng không ai duyệt.
 *
 * `#MIRER` (253 dòng `MIRER135`–`MIRER200`) CỐ Ý ĐỨNG NGOÀI — CEO chốt 08/10/2026: "MIRER đã
 * dừng rồi, không mở, Mirer là lấy trực tiếp từ trên Shopify về". Khớp với số đo: lượt nhận
 * cuối của mã `MIRER…` lên WH - Inventory là 31/10/2025, và loại nhập của chúng là
 * `Tồn kho (Consignment)` chứ không phải `Retail`. Đơn Mirer đang chạy là `MIR1001`–`MIR1028`,
 * đã có đủ trong `shopify_orders` dưới store `mirermirer-official` (nằm trong
 * `STORE_NHAN_HANG`) nên vào ô tìm qua đường Shopify, không qua đường này.
 *
 * Lưu ý cái bẫy: cột `store` của CẢ HAI nhóm đều là `#MIRER`. Thêm `'#MIRER'` vào đây là kéo
 * theo 28 dòng `MIR…` vốn đã có ở nguồn Shopify — `timMonLark` có mệnh đề `NOT EXISTS` chặn,
 * nhưng đừng dựa vào đó: dòng đó chỉ chặn trùng, không làm `Tồn kho (Consignment)` thành đúng.
 *
 * `MCN` (70), `MOS` (52), `MER-` (88) vẫn chưa rõ là kênh gì — chưa hỏi, chưa mở.
 */
export const STORE_MON_LARK: readonly string[] = ['#MTB', '#MXHS'];

/** Kênh này có được nhận qua bảng món Lark không. Giá trị lạ → KHÔNG, không đoán. */
export function nhanQuaMonLark(store: string | null | undefined): boolean {
  const s = store?.trim();
  return !!s && STORE_MON_LARK.includes(s);
}

/**
 * THUẦN: store nào có đồ khách trả về THỰC SỰ vào kho WH (CEO/Bảo 09/10/2026).
 *
 * KHÔNG dùng chung `STORE_NHAN_HANG`: hai câu hỏi khác nhau. `STORE_NHAN_HANG` trả lời "hàng
 * brand gửi tới có được nhận không"; danh sách này trả lời "hàng khách trả về có đi vào kho WH
 * không". Một store có thể đúng ở vế đầu mà sai ở vế sau.
 *
 * Bằng chứng cho từng store:
 *  - `meanblvd` — CÓ. Luồng chính: 637 dòng `Tồn kho (Return)` trên bảng vận hành gần như toàn
 *    bộ mang mã `#MBLVD`, và 24/25 dòng đang ở cửa nhận là của store này.
 *  - `tinhatelier` — KHÔNG, dù nó NẰM TRONG `STORE_NHAN_HANG`. Bảo 09/10/2026: *"Hàng của Tinh
 *    về không nhập vào kho của WH. Nhận và auto gửi về GA"*. Bày đồ return của Tinh ở ô tìm là
 *    mời kho nhận thứ họ sẽ không bao giờ thấy.
 *  - `happy-clothing-global` — KHÔNG. Store này CỐ Ý nằm ngoài `STORE_NHAN_HANG` (CEO
 *    29/09/2026); mời nhận đồ return của nó là tự mâu thuẫn với chính quyết định đó.
 *  - `mirermirer-official` — chưa có bằng chứng nào về đường đồ return, nên chưa mở.
 *
 * Danh sách CHO PHÉP, cùng lý lẽ `STORE_NHAN_HANG`: store mới thì KHÔNG tìm thấy hàng và kho
 * báo ngay, thay vì tự lọt vào rồi không ai hay.
 */
export const STORE_RETURN_VE_KHO: readonly string[] = ['meanblvd.myshopify.com'];

/** Đồ return của store này có vào kho WH không. Domain lạ → KHÔNG, không đoán. */
export function returnVeKhoDuoc(shopDomain: string | null | undefined): boolean {
  const d = shopDomain?.trim().toLowerCase();
  return !!d && STORE_RETURN_VE_KHO.includes(d);
}
