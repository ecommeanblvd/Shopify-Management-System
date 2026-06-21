/** Builder thuần cho payload SMS→MMP orders. CHỈ field đã chốt (PII tối giản):
 *  orderNumber, store, tên người nhận, quốc gia ship, các dòng brand {sku,title,qty}.
 *  KHÔNG email/SĐT/địa chỉ chi tiết/giá. Không I/O. */
// `vendor` = giá trị cột vendor Shopify (= brandSlug ở brand-request) để MMP route
// đơn về đúng brand. KHÔNG email/SĐT/địa chỉ/giá.
export interface MmpOrderLine { sku: string | null; title: string; qty: number; vendor: string | null }
export interface MmpOrderPayload {
  orderNumber: string; store: string;
  recipientName: string | null; shipCountry: string | null;
  /** Ngày phát sinh đơn (Shopify processed_at, ISO) — để MMP gán đúng tháng cho
   *  công nợ/doanh thu, KHÔNG dùng thời điểm MMP nhận (ingest). null nếu thiếu. */
  placedAt: string | null;
  lines: MmpOrderLine[];
}
export function buildMmpOrderPayload(input: {
  orderNumber: string; store: string; recipientName: string | null; shipCountry: string | null;
  placedAt: string | null;
  brandLines: MmpOrderLine[];
}): MmpOrderPayload {
  return {
    orderNumber: input.orderNumber,
    store: input.store,
    recipientName: input.recipientName,
    shipCountry: input.shipCountry,
    placedAt: input.placedAt,
    lines: input.brandLines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty, vendor: l.vendor })),
  };
}
