/**
 * @deprecated Phí đóng gói KHÔNG còn cộng ở tầng này. Nay là surcharge
 * configurable `packaging_fixed` (per carrier account, ĐƠN VỊ USD) áp TRONG
 * quote engine — `finalDisplay` đã bao gồm packaging+markup cho CẢ engine lẫn
 * manual. Hằng số giữ lại để tương thích/tham chiếu lịch sử (giá trị $5 cũ).
 */
export const PACKING_FEE_USD = 5;
export const ROUND_UP_USD = 0.5;

export interface CountryQuote { carrierCostDisplay: number; finalDisplay: number }

/** Giá offer FedEx cho 1 shipping-zone tại 1 bậc cân: lấy MAX `finalDisplay`
 *  trên các nước (cover toàn zone), làm tròn LÊN bội số $0.5. `finalDisplay` đã
 *  gồm phí đóng gói (packaging_fixed) + markup do quote engine tính, nên KHÔNG
 *  cộng $5 lại ở đây. null khi không có nước nào định giá được. */
export function fedexOfferPrice(quotes: CountryQuote[]): number | null {
  let best: number | null = null;
  for (const q of quotes) {
    if (!(q.finalDisplay > 0)) continue;
    if (best === null || q.finalDisplay > best) best = q.finalDisplay;
  }
  if (best === null) return null;
  return Math.ceil(best / ROUND_UP_USD) * ROUND_UP_USD;
}
