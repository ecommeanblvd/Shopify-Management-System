/** Builder thuần cho payload SMS→MMP orders. CHỈ field đã chốt (PII tối giản):
 *  orderNumber, store, tên người nhận, quốc gia ship, các dòng brand {sku,title,qty}.
 *  KHÔNG email/SĐT/địa chỉ chi tiết/giá. Không I/O. */
export interface MmpOrderLine { sku: string | null; title: string; qty: number }
export interface MmpOrderPayload {
  orderNumber: string; store: string;
  recipientName: string | null; shipCountry: string | null;
  lines: MmpOrderLine[];
}
export function buildMmpOrderPayload(input: {
  orderNumber: string; store: string; recipientName: string | null; shipCountry: string | null;
  brandLines: MmpOrderLine[];
}): MmpOrderPayload {
  return {
    orderNumber: input.orderNumber,
    store: input.store,
    recipientName: input.recipientName,
    shipCountry: input.shipCountry,
    lines: input.brandLines.map((l) => ({ sku: l.sku, title: l.title, qty: l.qty })),
  };
}
