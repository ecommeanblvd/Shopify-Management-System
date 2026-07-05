/**
 * Client-safe constants & types for the returns queue admin UI.
 *
 * This module deliberately imports NOTHING server-only (no `@/db/client`, no
 * server actions). Client components (`ReturnsTable`) import the status list +
 * row type from here so the Postgres client never gets bundled into the browser
 * build. The DB query lives in `returns-admin.ts`; the mutating action lives in
 * `returns-actions.ts`.
 */

/** Trạng thái vòng đời của một yêu cầu đổi/trả. */
export const RETURN_STATUSES = ['requested', 'approved', 'rejected', 'received', 'refunded'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export interface AdminReturnRow {
  id: string;
  storeName: string;
  orderNumber: string | null;
  shopifyCustomerId: string;
  reason: string;
  note: string | null;
  status: string;
  adminNote: string | null;
  createdAt: Date;
}
