/** Builder thuần cho payload SMS→MMP orders. CHỈ field đã chốt (PII tối giản):
 *  orderNumber, store, tên người nhận, quốc gia ship, các dòng brand {sku,title,qty,vendor,receivedAt}.
 *  KHÔNG email/SĐT/địa chỉ chi tiết. GIÁ:
 *  - Store RIÊNG của brand (tinhatelier/mirermirer): giá line + KHỐI pricing cấp đơn.
 *  - Store ĐA-BRAND (meanblvd/cici — CEO 30/07, phương án 1): giá THEO LINE
 *    (unitPrice + lineDiscount) nhưng KHÔNG tổng cấp đơn — MMP phải lọc line theo
 *    vendor, brand chỉ được thấy giá line của CHÍNH brand mình. Không I/O. */
// `vendor` = giá trị cột vendor Shopify (= brandSlug ở brand-request) để MMP route
// đơn về đúng brand. KHÔNG email/SĐT/địa chỉ.
// `receivedAt` = ngày hàng về kho (per-line) để MMP đối soát công nợ theo brand.
// `unitPrice` (đơn giá bán, order currency); `lineDiscount` = giảm giá PHÂN BỔ cho
// line (order currency) — giá thực thu của line = unitPrice×qty − lineDiscount.
export interface MmpOrderLine { sku: string | null; title: string; qty: number; vendor: string | null; receivedAt: string | null; unitPrice?: number | null; lineDiscount?: number | null }

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
  /** Tổng tiền ĐÃ HOÀN cho khách (order currency, Σ mọi lần refund — hoàn MỘT
   *  PHẦN cũng có số). 0 = chưa hoàn. Doanh thu thực = totalPrice − refundedAmount.
   *  (MMP yêu cầu 30/07 — engine tự trừ doanh thu.) */
  refundedAmount?: number;
  /** Chi tiết TỪNG LẦN hoàn (31/07 — MMP đối soát hoàn gì): amount = tổng tiền
   *  hoàn lần đó; shippingAmount = phần hoàn PHÍ SHIP; lines = hoàn ĐỒ theo SKU
   *  (amount line = subtotal phần hoàn của SKU đó). Lưu ý pattern Shopify: có lần
   *  "trả hàng" ghi lines nhưng amount = 0, tiền hoàn thật nằm ở lần refund khác
   *  không gắn lines — MMP nên đối soát theo TỔNG refundedAmount + dùng lines để
   *  biết sản phẩm nào bị trả. Key vắng mặt = đơn không có refund. */
  refunds?: Array<{
    refundedAt: string;
    amount: number;
    shippingAmount?: number;
    lines?: Array<{ sku: string | null; title: string | null; qty: number; amount: number }>;
  }>;
  /** CHI PHÍ SHIP thực của MEAN cho đơn (03/08 — hiện chỉ đơn TA), TOÀN BỘ
   *  bằng VND (CEO chốt): cước carrier THẬT từ bill + phí đóng gói/xử lý INS
   *  ($5/đơn quy VND). **totalVnd = carrierVnd + insHandlingVnd** — số MMP dùng
   *  làm "chi phí ship" khi đối soát với brand. Key vắng mặt = đơn chưa có bill
   *  carrier trong SMS (đơn cũ trước hệ thống / đơn VN / POS) — KHÔNG suy đoán. */
  shippingCost?: {
    carrierVnd: number;
    insHandlingVnd: number;
    totalVnd: number;
    /** carrier_bill = từ hoá đơn carrier trong SMS; ops_sheet = ops tra tay từ
     *  bill cũ (sheet Lark 04/08 — đơn 2024-05/2025 trước hệ thống). */
    source: 'carrier_bill' | 'ops_sheet';
  };
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
  /** Currency của đơn — BẮT BUỘC kèm khi line có unitPrice mà KHÔNG có pricing
   *  (store đa-brand, phương án 1): validator MMP đòi currency cấp gốc. */
  currency?: string | null;
}): MmpOrderPayload {
  const linesHavePrice = input.brandLines.some((l) => l.unitPrice != null);
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
      // Key giá chỉ xuất hiện khi có dữ liệu — đơn cũ thiếu giá giữ nguyên shape cũ.
      ...(l.unitPrice != null ? { unitPrice: l.unitPrice } : {}),
      ...(l.lineDiscount != null ? { lineDiscount: l.lineDiscount } : {}),
    })),
    // currency cấp gốc: theo pricing (store riêng), hoặc kèm riêng khi line có giá
    // (store đa-brand — validator MMP bắt buộc currency khi có unitPrice).
    ...(input.pricing
      ? { currency: input.pricing.currency, pricing: input.pricing }
      : linesHavePrice && input.currency ? { currency: input.currency } : {}),
  };
}
