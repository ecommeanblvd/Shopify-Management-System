// Pure view-model helpers for the Order Journey UI (Task 9).
// No DOM/Preact/network here — kept unit-testable in isolation.

export interface PolicyJson {
  canCancel: 'free' | 'fee40' | null;
  canClaim: boolean;
  claimDeadline: string | null;
  refundPercent: 100 | 60;
  refundAmount: string;
  feeAmount: string;
}

export type StageTone = 'info' | 'success' | 'critical' | 'neutral';

const STAGE_MAP: Record<string, { label: string; tone: StageTone }> = {
  placed: { label: 'In production', tone: 'info' },
  production: { label: 'In production', tone: 'info' },
  qc: { label: 'Quality check', tone: 'info' },
  pack: { label: 'Packed', tone: 'info' },
  ship: { label: 'Shipped', tone: 'info' },
  deliver: { label: 'Delivered', tone: 'success' },
  completed: { label: 'Delivered', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'critical' },
  refunded: { label: 'Refunded', tone: 'critical' },
};

/** Maps a raw `currentStage` value to a display label + badge tone. */
export function stageChip(currentStage: string | null): { label: string; tone: StageTone } {
  if (!currentStage) return { label: 'Processing', tone: 'neutral' };
  return STAGE_MAP[currentStage] ?? { label: 'Processing', tone: 'neutral' };
}

/** Cancellation copy driven entirely by server-computed `policy` — never recomputed client-side. */
export function cancelCopy(policy: PolicyJson): string | null {
  if (policy.canCancel === 'free') {
    return `Free cancellation — full refund (${fmtMoneyForPolicy(policy.refundAmount)})`;
  }
  if (policy.canCancel === 'fee40') {
    return `Production has started. Cancellation fee 40% (${fmtMoneyForPolicy(policy.feeAmount)}). You will be refunded ${fmtMoneyForPolicy(policy.refundAmount)} (60%).`;
  }
  return null;
}

// Policy amounts are always store currency (USD) money strings; kept local so cancelCopy
// doesn't need a currency param from callers that only have the policy object.
function fmtMoneyForPolicy(amount: string): string {
  return `$${amount}`;
}

const REQUEST_STATUS_LABELS: Record<string, Record<string, string>> = {
  cancel: {
    pending: 'Cancellation pending',
    approved: 'Cancellation approved',
    rejected: 'Cancellation rejected',
    completed: 'Cancellation completed',
  },
  claim: {
    pending: 'Claim under review',
    approved: 'Claim approved',
    rejected: 'Claim rejected',
    completed: 'Claim completed',
  },
};

/** English label for a request's (kind, status) pair. Falls back to a generic composition. */
export function requestStatusLabel(kind: string, status: string): string {
  return REQUEST_STATUS_LABELS[kind]?.[status] ?? `${kind} ${status}`;
}

/** Formats a money string for display; `$X.XX` for USD, `"amount currency"` fallback otherwise. */
export function fmtMoney(amount: string, currency: string): string {
  if (currency === 'USD') {
    const n = Number(amount);
    if (Number.isFinite(n)) return `$${n.toFixed(2)}`;
    return `$${amount}`;
  }
  return `${amount} ${currency}`;
}
