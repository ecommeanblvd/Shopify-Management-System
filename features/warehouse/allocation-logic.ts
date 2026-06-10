/** Pure allocation logic — no DB. Spec §3:
 *  docs/superpowers/specs/2026-06-10-warehouse-core-auto-allocation-design.md */

export interface StockCandidate { code: string; available: number }

/** Kho khả dụng nhiều nhất; hoà -> HN trước (rồi alphabet cho kho tương lai). */
export function pickWarehouse(stocks: StockCandidate[]): string | null {
  const positive = stocks.filter((s) => s.available > 0);
  if (positive.length === 0) return null;
  positive.sort((a, b) =>
    b.available - a.available
    || ((b.code === 'HN' ? 1 : 0) - (a.code === 'HN' ? 1 : 0))
    || a.code.localeCompare(b.code));
  return positive[0].code;
}

export interface AllocationPlan { warehouseCode: string; qty: number }

/** Đủ-hoặc-không tại MỘT kho (v1 không tách kiện giữa hai kho). */
// NOTE(T4): caller chỉ cần truyền { qty }
export function planAllocation(
  line: { qty: number },
  stocks: StockCandidate[],
): AllocationPlan | null {
  if (line.qty <= 0) return null;
  const code = pickWarehouse(stocks.filter((s) => s.available >= line.qty));
  return code ? { warehouseCode: code, qty: line.qty } : null;
}

/** FIFO theo thời điểm đơn về; thiếu mốc thời gian xếp cuối. */
export function fifoOrder<T extends { orderProcessedAt: Date | null }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    if (a.orderProcessedAt === null) return b.orderProcessedAt === null ? 0 : 1;
    if (b.orderProcessedAt === null) return -1;
    return a.orderProcessedAt.getTime() - b.orderProcessedAt.getTime();
  });
}

export interface MovementDelta { deltaOnHand: number; deltaReserved: number }

/** Bất biến tồn sau movement: on_hand ≥ 0, 0 ≤ reserved ≤ on_hand, delta ≠ rỗng. */
export function validateMovement(
  inv: { qtyOnHand: number; qtyReserved: number },
  d: MovementDelta,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(d.deltaOnHand) || !Number.isInteger(d.deltaReserved)) {
    return { ok: false, error: 'Delta không phải số nguyên hợp lệ' };
  }
  if (d.deltaOnHand === 0 && d.deltaReserved === 0) return { ok: false, error: 'Movement rỗng' };
  const onHand = inv.qtyOnHand + d.deltaOnHand;
  const reserved = inv.qtyReserved + d.deltaReserved;
  if (onHand < 0) return { ok: false, error: `on_hand âm (${onHand})` };
  if (reserved < 0) return { ok: false, error: `reserved âm (${reserved})` };
  if (reserved > onHand) return { ok: false, error: `reserved (${reserved}) vượt on_hand (${onHand})` };
  return { ok: true };
}
