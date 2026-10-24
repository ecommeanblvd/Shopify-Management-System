/**
 * Danh tính của người (hoặc cái máy) đứng sau một lượt ghi.
 *
 * Thuần, không I/O: chỗ ĐẶT danh tính xuống CSDL nằm ở `ghi-voi.ts`. Tách ra vì cái
 * đáng kiểm bằng `vitest` ở đây là NHÃN — nhãn trùng nhau hoặc nhãn rỗng thì màn
 * "Lịch sử" không còn phân biệt được nguồn nào ghi, mà lỗi đó không có cách nào thấy
 * được từ một lệnh SQL.
 */

/**
 * `nguoi` mang `userId` (khoá chính bảng `user`), KHÔNG mang tên: tên người đổi được,
 * còn nhật ký phải giữ nguyên bằng chứng. Màn hình tự tra tên theo id lúc đọc.
 * `may` mang nhãn hiển thị luôn, vì không có bản ghi người nào để tra.
 */
export type TacNhan = { kieu: 'nguoi'; userId: string } | { kieu: 'may'; nhan: string };

/**
 * Các nguồn MÁY ghi vào 10 bảng được theo dõi. CEO chốt 20/10/2026: *"Ghi rõ 'Đồng bộ
 * Lark' luôn, cần thấy hết"* — nên mỗi nguồn có nhãn RIÊNG, không gộp thành một chữ
 * "Hệ thống". Gộp lại thì lúc một ô bị đổi sai không còn biết phải đi tìm ở cron, ở
 * webhook hay ở tệp nhập.
 *
 * Nhãn là chuỗi NGƯỜI ĐỌC, hiện thẳng lên màn hình, nên viết có dấu.
 */
export const MAY = {
  /** Cron `sync-lark` đọc bảng LOG-Export rồi vá `shipments`. */
  DONG_BO_LARK: 'Đồng bộ Lark',
  /** Webhook `/api/lark/pack` — Lark tự bắn một dòng sang ngay khi Ops sửa. */
  LARK_BAN_VE: 'Lark bắn về',
  /**
   * Bộ đồng bộ đơn Shopify — `upsertOrder` (`features/shopify-orders/sync/upsert-order.ts`),
   * đường ghi DUY NHẤT vào `shopify_orders` / `shopify_order_lines` của cả ba kênh
   * (webhook, cron hằng giờ, backfill).
   *
   * Vì sao phải có nhãn TRƯỚC khi bật trigger cho hai bảng đó: `cot-theo-doi.ts` theo dõi
   * `quantity`/`unit_price`/`total`/`sku` của dòng đơn, mà mọi lượt đồng bộ đều ghi đúng
   * mấy cột ấy. Chưa gắn nhãn thì mọi dòng nhật ký sinh ra rơi vào "Chưa gắn danh tính" —
   * lẫn đúng vào nhóm LỖI QUÊN BỌC, nên không còn đếm được cái nào là cái nào.
   *
   * Cố ý MỘT nhãn cho cả ba kênh, không tách như Lark (`DONG_BO_LARK` / `LARK_BAN_VE`):
   * ba kênh dùng chung một mapper và kênh nào ghi cũng đã nằm ở cột `shopify_orders.source`.
   */
  DONG_BO_SHOPIFY: 'Đồng bộ Shopify',
  /** Các cron khác không phải đồng bộ Lark. */
  CRON: 'Cron',
  /** Nhập tệp Excel LOG-Export (`features/shipments/import-actions.ts`). */
  NHAP_FILE: 'Nhập file',
  /** Script chạy tay trong `scripts/`. */
  SCRIPT: 'Script',
} as const;

/**
 * Nhãn ghi vào cột `nhat_ky_thay_doi.tac_nhan_nhan`.
 *
 * Người thì RỖNG, không phải tên: đã có `tac_nhan_id` để tra tên lúc đọc, ghi thêm tên
 * vào đây là nhân đôi một sự thật rồi lệch nhau khi người đó đổi tên. Rỗng cũng đúng ý
 * trigger — `nhat_ky_ghi()` chạy `nullif(…, '')` nên ô này thành NULL thật.
 */
export function nhanTacNhan(t: TacNhan): string {
  return t.kieu === 'nguoi' ? '' : t.nhan;
}

/**
 * Giá trị ghi vào cột `nhat_ky_thay_doi.tac_nhan_id` — ngược lại: chỉ người mới có.
 * Máy trả rỗng (→ NULL) để không ai lọc "thay đổi của người X" mà hứng cả cron.
 */
export function idTacNhan(t: TacNhan): string {
  return t.kieu === 'nguoi' ? t.userId : '';
}
