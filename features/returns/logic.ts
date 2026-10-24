/** Pure customer-returns logic — no DB. Code format, draft + QC validation,
 *  restock delta, and refund reconciliation flag. */

export type CustomerReturnStatus = 'open' | 'completed' | 'cancelled';

/** Human code per order, e.g. nextReturnCode('1042', 1) => 'CR-1042-1'. */
export function nextReturnCode(orderNumber: string, seq: number): string {
  return `CR-${orderNumber}-${seq}`;
}

export interface ReturnDraftLineInput { shopifyLineId: string; returnedQty: number; }
export interface ValidateReturnDraftInput { orderId: string; lines: ReturnDraftLineInput[]; }

export function validateReturnDraft(input: ValidateReturnDraftInput): { ok: true } | { ok: false; error: string } {
  if (!input.orderId) return { ok: false, error: 'Thiếu đơn hàng' };
  if (input.lines.length === 0) return { ok: false, error: 'Cần ít nhất một dòng hàng' };
  const seen = new Set<string>();
  for (const l of input.lines) {
    if (!l.shopifyLineId) return { ok: false, error: 'Thiếu dòng đơn hàng' };
    if (seen.has(l.shopifyLineId)) return { ok: false, error: 'Dòng đơn hàng bị trùng' };
    seen.add(l.shopifyLineId);
    if (!(l.returnedQty > 0)) return { ok: false, error: 'Số lượng trả phải lớn hơn 0' };
  }
  return { ok: true };
}

export interface QcLineInput { returnedQty: number; passQty: number; failQty: number; }

export function validateReturnQc(lines: QcLineInput[]): { ok: true } | { ok: false; error: string } {
  if (lines.length === 0) return { ok: false, error: 'Không có dòng để QC' };
  for (const l of lines) {
    if (l.passQty < 0 || l.failQty < 0) return { ok: false, error: 'Số lượng QC không được âm' };
    if (l.passQty + l.failQty > l.returnedQty) return { ok: false, error: 'Pass + fail vượt số lượng trả' };
  }
  return { ok: true };
}

/** On-hand restock delta for a QC'd line. Stock only moves when there's a SKU. */
export function restockEffect(line: { sku: string | null; passQty: number }): { onHandDelta: number } {
  return { onHandDelta: line.sku ? line.passQty : 0 };
}

export type RefundReconcileFlag = 'refunded' | 'awaiting_refund' | 'none';

/** Compare internal QC-passed goods against Shopify's refund record. */
export function refundReconcileFlag(input: { totalPassQty: number; shopifyRefundCount: number }): RefundReconcileFlag {
  if (input.shopifyRefundCount > 0) return 'refunded';
  if (input.totalPassQty > 0) return 'awaiting_refund';
  return 'none';
}
