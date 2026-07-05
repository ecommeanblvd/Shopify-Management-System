/** THUẦN: state machine của customer_order_requests (spec §5). */
export type RequestKind = 'cancel' | 'claim';
export type RequestStatus = 'submitted' | 'under_review' | 'approved' | 'rejected'
  | 'return_in_transit' | 'received' | 'refund_pending' | 'refunded';

export const CLAIM_REASONS = ['damaged_package', 'damaged_product', 'wrong_item', 'wrong_size', 'missing_item', 'other'] as const;
export type ClaimReason = (typeof CLAIM_REASONS)[number];

const TERMINAL: RequestStatus[] = ['rejected', 'refunded'];
export const OPEN_STATUSES: RequestStatus[] =
  ['submitted', 'under_review', 'approved', 'return_in_transit', 'received', 'refund_pending'];

const CLAIM_EDGES: Record<RequestStatus, RequestStatus[]> = {
  submitted: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['return_in_transit'],
  return_in_transit: ['received'],
  received: ['refund_pending', 'rejected'],   // QC pass | fail
  refund_pending: ['refunded'],
  rejected: [], refunded: [],
};
const CANCEL_EDGES: Record<RequestStatus, RequestStatus[]> = {
  refund_pending: ['refunded'],
  submitted: [], under_review: [], approved: [], return_in_transit: [], received: [], rejected: [], refunded: [],
};

export function canTransition(kind: RequestKind, from: RequestStatus, to: RequestStatus): boolean {
  if (TERMINAL.includes(from)) return false;
  return (kind === 'cancel' ? CANCEL_EDGES : CLAIM_EDGES)[from]?.includes(to) ?? false;
}

/** THUẦN: validate input claim (reason codes hợp lệ + số ảnh 1-5). Rác trong reasonCodes bị âm thầm loại bỏ. */
export function validateClaimInput(reasonCodes: string[], photoKeys: string[]):
  { ok: true; reasons: ClaimReason[] } | { ok: false; error: string } {
  const reasons = reasonCodes.filter((r): r is ClaimReason =>
    (CLAIM_REASONS as readonly string[]).includes(r));
  if (reasons.length === 0) return { ok: false, error: 'select at least one issue' };
  if (photoKeys.length < 1 || photoKeys.length > 5) return { ok: false, error: 'photos: 1-5 required' };
  return { ok: true, reasons };
}

/** Extract PG error code từ DrizzleQueryError (wrap pg error ở .cause). */
export function pgErrorCode(e: unknown): string | undefined {
  return (e as { code?: string; cause?: { code?: string } })?.code
    ?? (e as { cause?: { code?: string } })?.cause?.code;
}
