/**
 * Client-safe types for the return hubs admin UI.
 *
 * This module deliberately imports NOTHING server-only (no `@/db/client`, no
 * server actions). Client components (`HubsEditor`) import the row type from
 * here so the Postgres client never gets bundled into the browser build. The
 * DB query lives in `hubs-admin.ts`; the mutating actions live in
 * `hubs-actions.ts`.
 */

/** Một địa chỉ kho nhận hàng đổi/trả. */
export interface HubRow {
  id: string;
  label: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  active: boolean;
}
