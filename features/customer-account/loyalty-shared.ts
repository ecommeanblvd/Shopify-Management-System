/**
 * Client-safe types for the loyalty admin UI. Imports nothing server-only so
 * client components (`LoyaltyEditor`) can import the row type without bundling
 * the Postgres client. DB query lives in `loyalty-admin.ts`; mutating actions
 * in `loyalty-actions.ts`.
 */

export interface AdminLoyaltyRow {
  id: string;
  storeId: string;
  storeName: string;
  shopifyCustomerId: string;
  tier: string;
  note: string | null;
  updatedAt: Date;
}
