/** THUẦN: policy engine Order Journey — NƠI DUY NHẤT tính quyền hành động + tiền refund.
 *  Chính sách khóa (spec 2026-07-05 §2): free cancel đến brand-confirm; sau đó fee 40%
 *  đến trước ship; claim 14 ngày sau delivered, refund 100%. Snapshot tiền do caller lưu. */

export const CLAIM_WINDOW_DAYS = 14;

export interface PolicyInput {
  placedAt: Date | null;
  productionConfirmedAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  cancelledAt: Date | null;
  orderTotal: string;
  currency: string;
  hasOpenRequest: boolean;
  now: Date;
}
export type CancelMode = 'free' | 'fee40' | null;
export interface PolicyResult {
  canCancel: CancelMode;
  canClaim: boolean;
  claimDeadline: Date | null;
  refundPercent: 100 | 60;
  refundAmount: string;
  feeAmount: string;
}

/** Nhân tiền theo cents để tránh lỗi float; xuất chuỗi 2 số lẻ. */
export function money(total: string, pct: number): string {
  const cents = Math.round(Number(total) * 100);
  return (Math.round(cents * pct) / 100).toFixed(2);
}

export function evaluateOrderPolicy(i: PolicyInput): PolicyResult {
  const dead = i.deliveredAt
    ? new Date(i.deliveredAt.getTime() + CLAIM_WINDOW_DAYS * 24 * 3600 * 1000)
    : null;
  const terminal = !!i.cancelledAt;
  const blocked = terminal || i.hasOpenRequest;

  let canCancel: CancelMode = null;
  if (!blocked && !i.shippedAt) canCancel = i.productionConfirmedAt ? 'fee40' : 'free';

  const canClaim = !blocked && !!i.deliveredAt && !!dead && i.now.getTime() <= dead.getTime();

  const refundPercent: 100 | 60 = canCancel === 'fee40' ? 60 : 100;
  return {
    canCancel,
    canClaim,
    claimDeadline: dead,
    refundPercent,
    refundAmount: money(i.orderTotal, refundPercent / 100),
    feeAmount: canCancel === 'fee40' ? money(i.orderTotal, 0.4) : '0.00',
  };
}
