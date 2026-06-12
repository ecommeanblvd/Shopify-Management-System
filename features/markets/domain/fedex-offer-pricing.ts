export const PACKING_FEE_USD = 5;
export const ROUND_UP_USD = 0.5;

export interface CountryQuote { carrierCostDisplay: number; finalDisplay: number }

/** Giá offer FedEx cho 1 shipping-zone tại 1 bậc cân: với mỗi nước tính
 *  (cost + $5) × markupFactor (factor = finalDisplay/carrierCostDisplay), lấy MAX
 *  trên các nước (cover toàn zone), làm tròn LÊN bội số $0.5. null khi không có
 *  nước nào định giá được. */
export function fedexOfferPrice(quotes: CountryQuote[]): number | null {
  let best: number | null = null;
  for (const q of quotes) {
    if (!(q.carrierCostDisplay > 0)) continue;
    const factor = q.finalDisplay / q.carrierCostDisplay;
    const price = (q.carrierCostDisplay + PACKING_FEE_USD) * factor;
    if (best === null || price > best) best = price;
  }
  if (best === null) return null;
  return Math.ceil(best / ROUND_UP_USD) * ROUND_UP_USD;
}
