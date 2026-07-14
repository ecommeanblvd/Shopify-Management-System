/** Sai lệch cost thực vs dự tính ≤ mức này (VND) coi là làm tròn → tự đẩy giá,
 *  KHÔNG cần operator duyệt. Trên mức này → đơn chờ accept/claim. */
export const REVIEW_TOLERANCE_VND = 100;

export type ReconcileDecision = 'pending_review' | 'accepted' | 'claiming';

/**
 * THUẦN: quyết định trạng thái đối soát khi bill về + có đẩy giá thu chính thức không.
 *   - Đã CHỐT (accepted/claiming) → GIỮ nguyên; cron chạy lại KHÔNG ghi đè.
 *   - Có sai lệch (|delta| > tolerance) → 'pending_review', CHƯA đẩy giá (chờ operator).
 *   - Khớp (trong tolerance) → decision null, tự đẩy giá như cũ.
 * Đẩy giá `order.reconciled` CHỈ khi decision null (tự khớp) hoặc 'accepted' (chốt lỗi nội bộ).
 */
export function decideReconcile(
  deltaVnd: number | null,
  prevDecision: string | null,
  toleranceVnd: number = REVIEW_TOLERANCE_VND,
): { decision: ReconcileDecision | null; shouldEmitCharge: boolean } {
  const decided = prevDecision === 'accepted' || prevDecision === 'claiming';
  const hasDiscrepancy = deltaVnd != null && Math.abs(deltaVnd) > toleranceVnd;
  const decision: ReconcileDecision | null = decided
    ? (prevDecision as ReconcileDecision)
    : hasDiscrepancy ? 'pending_review' : null;
  const shouldEmitCharge = decision === null || decision === 'accepted';
  return { decision, shouldEmitCharge };
}
