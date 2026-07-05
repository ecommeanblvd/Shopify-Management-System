/**
 * Client-safe constants & types for the order-journey requests admin UI.
 *
 * This module deliberately imports NOTHING server-only (no `@/db/client`, no
 * server actions). Client components (`RequestsTable`) import the status list
 * + row type from here so the Postgres client never gets bundled into the
 * browser build. The DB query lives in `requests-admin.ts`; the mutating
 * actions live in `requests-actions.ts`.
 */

/** Toàn bộ trạng thái vòng đời của customer_order_requests (xem request-status.ts). */
export const REQUEST_STATUSES = [
  'submitted', 'under_review', 'approved', 'rejected',
  'return_in_transit', 'received', 'refund_pending', 'refunded',
] as const;
export type RequestStatusValue = (typeof REQUEST_STATUSES)[number];

/** Loại yêu cầu: hủy đơn hoặc khiếu nại (hư hỏng/thiếu/sai hàng...). */
export const REQUEST_KINDS = ['cancel', 'claim'] as const;
export type RequestKindValue = (typeof REQUEST_KINDS)[number];

export interface AdminRequestRow {
  id: string;
  storeName: string;
  orderNumber: string | null;
  kind: string;
  status: string;
  shopifyCustomerId: string;
  reasonCodes: string[] | null;
  description: string | null;
  photoUrls: string[];            // signed URLs (5 phút) — build ở admin query
  fault: string | null;
  returnHubId: string | null;
  returnHubLabel: string | null;
  returnShippingPayer: string | null;
  returnTrackingNumber: string | null;
  returnCarrier: string | null;
  refundAmount: string;
  currency: string;
  refundPercent: number;
  adminNote: string | null;
  rejectedReason: string | null;
  createdAt: Date;
}
