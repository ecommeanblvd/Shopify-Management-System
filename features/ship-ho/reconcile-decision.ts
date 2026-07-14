/** Sai lệch cost thực vs dự tính ≤ mức này (VND) coi là làm tròn → tự đẩy giá,
 *  KHÔNG cần operator duyệt. Trên mức này → đơn chờ accept/claim. */
export const REVIEW_TOLERANCE_VND = 100;

export type ReconcileDecision =
  | 'pending_review'   // có sai lệch, chờ operator
  | 'accepted'         // chấp nhận lỗi nội bộ → đẩy giá theo bill
  | 'claiming'         // đang đòi carrier → chưa đẩy giá
  | 'claim_credited'   // claim xong: carrier credit → đẩy giá theo bill
  | 'claim_rejected';  // claim xong: carrier từ chối → đẩy giá theo bill

/** Trạng thái đã CHỐT (cron chạy lại KHÔNG ghi đè). */
const DECIDED = new Set(['accepted', 'claiming', 'claim_credited', 'claim_rejected']);
/** Trạng thái đã có giá cuối → đẩy `order.reconciled` (khác 'claiming' = còn treo). */
const CHARGE_FINALISED = new Set([null, 'accepted', 'claim_credited', 'claim_rejected']);

/**
 * THUẦN: quyết định trạng thái đối soát khi bill về + có đẩy giá thu chính thức không.
 *   - Đã CHỐT (accepted/claiming/claim_*) → GIỮ nguyên; cron chạy lại KHÔNG ghi đè.
 *   - Có sai lệch (|delta| > tolerance) → 'pending_review', CHƯA đẩy giá (chờ operator).
 *   - Khớp (trong tolerance) → decision null, tự đẩy giá như cũ.
 * Đẩy giá `order.reconciled` khi decision null / accepted / claim_credited / claim_rejected
 * (đã có giá cuối). 'pending_review' và 'claiming' → chưa đẩy.
 */
export function decideReconcile(
  deltaVnd: number | null,
  prevDecision: string | null,
  toleranceVnd: number = REVIEW_TOLERANCE_VND,
): { decision: ReconcileDecision | null; shouldEmitCharge: boolean } {
  const hasDiscrepancy = deltaVnd != null && Math.abs(deltaVnd) > toleranceVnd;
  const decision: ReconcileDecision | null = DECIDED.has(prevDecision ?? '')
    ? (prevDecision as ReconcileDecision)
    : hasDiscrepancy ? 'pending_review' : null;
  const shouldEmitCharge = CHARGE_FINALISED.has(decision);
  return { decision, shouldEmitCharge };
}

/** Trạng thái ô "Đối soát" trong bảng đơn (THUẦN). `actionable` → bấm mở modal. */
export type ReconcileCellKind = 'none' | 'waiting' | 'done' | 'review' | 'claiming';
export interface ReconcileCellState { kind: ReconcileCellKind; label: string; actionable: boolean }
export function reconcileCellState(
  reconcileStatus: string | null,
  decision: string | null,
  hasTracking: boolean,
): ReconcileCellState {
  if (reconcileStatus !== 'reconciled') {
    return hasTracking
      ? { kind: 'waiting', label: 'Chờ bill', actionable: false }
      : { kind: 'none', label: '—', actionable: false };
  }
  if (decision === 'pending_review') return { kind: 'review', label: '⚠ Cần đối soát', actionable: true };
  if (decision === 'claiming') return { kind: 'claiming', label: '⏳ Đang claim', actionable: true };
  // null | accepted | claim_credited | claim_rejected → đã chốt.
  return { kind: 'done', label: '✓ Đã đối soát', actionable: false };
}
