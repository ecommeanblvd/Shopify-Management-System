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
