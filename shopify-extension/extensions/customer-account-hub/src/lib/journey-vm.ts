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
  placed: { label: 'Order placed', tone: 'neutral' },
  production: { label: 'In production', tone: 'info' },
  qc: { label: 'Quality check', tone: 'info' },
  packed: { label: 'Packed', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'info' },
  in_transit: { label: 'Shipped', tone: 'info' },
  out_for_delivery: { label: 'Out for delivery', tone: 'info' },
  post_delivery: { label: 'Delivered', tone: 'success' },
  completed: { label: 'Delivered', tone: 'success' },
  refunded_full: { label: 'Refunded', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'critical' },
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
    submitted: 'Cancellation submitted',
    under_review: 'Cancellation under review',
    approved: 'Cancellation approved',
    rejected: 'Cancellation rejected',
    return_in_transit: 'Cancellation approved — refund processing',
    received: 'Cancellation approved — refund processing',
    refund_pending: 'Cancellation approved — refund processing',
    refunded: 'Cancelled & refunded',
  },
  claim: {
    submitted: 'Claim submitted — awaiting review',
    under_review: 'Claim under review',
    approved: 'Claim approved — please ship the item back',
    rejected: 'Claim rejected',
    return_in_transit: 'Return shipment in transit',
    received: 'Return received — quality check in progress',
    refund_pending: 'Refund processing',
    refunded: 'Refunded',
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

// Same 6 customer-facing stages as the backend default (`defaultTimeline` in
// features/customer-account/public-timeline.ts) — used when `timeline` is null
// (degrade safely instead of rendering nothing).
const DEFAULT_STEP_LABELS = [
  'Placed', 'In production', 'Quality check', 'Packed', 'Shipped', 'Delivered',
] as const;

export type StepState = 'done' | 'current' | 'upcoming';

export interface StepperStep {
  label: string;
  at: string | null;
  state: StepState;
}

/**
 * Builds the vertical stepper view-model from a journey timeline.
 * - `at != null` and not the current stage → done
 * - `label === currentStageLabel` → current
 * - everything else → upcoming
 * `timeline === null` → 6 default labels, all upcoming (no current — degrade safely).
 */
export function buildStepper(
  timeline: { currentStageLabel: string; steps: Array<{ label: string; at: string | null }> } | null,
): StepperStep[] {
  if (!timeline) {
    return DEFAULT_STEP_LABELS.map((label) => ({ label, at: null, state: 'upcoming' as StepState }));
  }
  return timeline.steps.map((step) => {
    const state: StepState =
      step.label === timeline.currentStageLabel ? 'current' : step.at != null ? 'done' : 'upcoming';
    return { label: step.label, at: step.at, state };
  });
}
