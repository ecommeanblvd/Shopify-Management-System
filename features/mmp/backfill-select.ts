/** Dedupe orderId rồi giới hạn N đơn đầu (để test push từng phần). THUẦN.
 *  limit để trống / ≤ 0 → đẩy tất cả. */
export function pickBackfillOrderIds(orderIds: string[], limit?: number): string[] {
  const deduped = [...new Set(orderIds)];
  return limit && limit > 0 ? deduped.slice(0, limit) : deduped;
}
