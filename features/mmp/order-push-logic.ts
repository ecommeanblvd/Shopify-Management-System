/** Builder thuần cho payload SMS→MMP orders. CHỈ field đã chốt (PII tối giản):
 *  orderNumber, store, tên người nhận, quốc gia ship, các dòng brand {sku,title,qty,vendor,receivedAt}.
 *  KHÔNG email/SĐT/địa chỉ chi tiết. GIÁ chỉ gửi cho STORE RIÊNG của brand
 *  (tinhatelier/mirermirer — chỉ đạo CEO 18/07: đối soát cần giá sản phẩm + ship);
 *  store đa-brand (meanblvd/cici) vẫn KHÔNG giá. Không I/O. */
// `vendor` = giá trị cột vendor Shopify (= brandSlug ở brand-request) để MMP route
// đơn về đúng brand. KHÔNG email/SĐT/địa chỉ.
// `receivedAt` = ngày hàng về kho (per-line) để MMP đối soát công nợ theo brand.
// `unitPrice` (đơn giá bán, order currency) — CHỈ store riêng của brand.
export interface MmpOrderLine { sku: string | null; title: string; qty: number; vendor: string | null; receivedAt: string | null; unitPrice?: number | null }

/** Khối giá cấp đơn (order currency) — CHỈ store riêng của brand. */
export interface MmpOrderPricing {
  currency: string;
  /** Σ đơn giá × qty các line trong payload (trước giảm giá). */
  subtotal: number;
  totalDiscount: number | null;
  /** Phí ship khách trả (SAU giảm). */
  totalShipping: number | null;
  /** Số tiền GIẢM phí ship (promo 50% off shipping…). Phí ship GỐC =
   *  totalShipping + totalShippingDiscount. null = đơn cũ chưa có dữ liệu. */
  totalShippingDiscount?: number | null;
  totalTax: number | null;
  /** Tổng khách thanh toán. */
  totalPrice: number | null;
  /** Cước HÀNG HOÀN đã phát sinh cho đơn (VND — khác currency trên; từ bill carrier). */
  returnShippingVnd?: number;
  /** Phí transaction cổng thanh toán quy về ĐỒNG ĐƠN (suy từ Shopify
   *  transactions.fees; null = đơn chưa có dữ liệu fees). */
  transactionFee?: number | null;
  /** Phí transaction NGUYÊN GỐC theo đồng payout của cổng (kèm currency dưới). */
  transactionFeeNative?: number | null;
  transactionFeeNativeCurrency?: string | null;
}
export interface MmpOrderPayload {
  orderNumber: string; store: string;
  recipientName: string | null; shipCountry: string | null;
  /** Ngày phát sinh đơn (Shopify processed_at, ISO) — để MMP gán đúng tháng cho
   *  công nợ/doanh thu, KHÔNG dùng thời điểm MMP nhận (ingest). null nếu thiếu. */
  placedAt: string | null;
  /** Ngày MEAN nhận hàng của ĐƠN (ISO 8601) = ngày nhận MỚI NHẤT trong các line
   *  brand đã về kho. MMP đọc field cấp-order này (tên CHÍNH XÁC 'receivedAt') để
   *  đối soát công nợ. null nếu chưa nhận. (Per-line receivedAt vẫn gửi ở lines.) */
  receivedAt: string | null;
  /** Trạng thái THANH TOÁN Shopify (displayFinancialStatus), giá trị thô:
   *  PENDING | AUTHORIZED | PAID | PARTIALLY_PAID | PARTIALLY_REFUNDED |
   *  REFUNDED | VOIDED | EXPIRED. MMP suy 'refunded'/'pending' từ đây. */
  financialStatus: string | null;
  /** Trạng thái GIAO HÀNG Shopify (displayFulfillmentStatus), giá trị thô:
   *  FULFILLED | UNFULFILLED | PARTIALLY_FULFILLED | IN_PROGRESS | ON_HOLD |
   *  SCHEDULED | RESTOCKED | null. MMP suy 'fulfilled' từ đây. */
  fulfillmentStatus: string | null;
  /** Thời điểm HUỶ đơn (ISO 8601) — null = chưa huỷ. MMP suy 'cancelled' = != null. */
  cancelledAt: string | null;
  lines: MmpOrderLine[];
  /** Currency CẤP GỐC — validator MMP (siết 21/07) bắt buộc khi line có unitPrice
   *  ("cannot default to VND"). = pricing.currency; vắng với store đa-brand. */
  currency?: string;
  /** CHỈ store riêng của brand — field vắng mặt với store đa-brand. */
  pricing?: MmpOrderPricing;
}
export function buildMmpOrderPayload(input: {
  orderNumber: string; store: string; recipientName: string | null; shipCountry: string | null;
  placedAt: string | null;
  receivedAt: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  cancelledAt: string | null;
  brandLines: MmpOrderLine[];
  pricing?: MmpOrderPricing | null;
}): MmpOrderPayload {
  return {
    orderNumber: input.orderNumber,
    store: input.store,
    recipientName: input.recipientName,
    shipCountry: input.shipCountry,
    placedAt: input.placedAt,
    receivedAt: input.receivedAt,
    financialStatus: input.financialStatus,
    fulfillmentStatus: input.fulfillmentStatus,
    cancelledAt: input.cancelledAt,
    lines: input.brandLines.map((l) => ({
      sku: l.sku, title: l.title, qty: l.qty, vendor: l.vendor, receivedAt: l.receivedAt,
      // Chỉ nhét key unitPrice khi có giá (store riêng) — payload store đa-brand giữ nguyên shape cũ.
      ...(l.unitPrice != null ? { unitPrice: l.unitPrice } : {}),
    })),
    ...(input.pricing ? { currency: input.pricing.currency, pricing: input.pricing } : {}),
  };
}
