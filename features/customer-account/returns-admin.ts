import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { AdminReturnRow } from './returns-shared';

export type { AdminReturnRow } from './returns-shared';
export { RETURN_STATUSES } from './returns-shared';

/**
 * Server-only DB reads for the returns queue admin page. This module imports
 * `@/db/client`, so it must ONLY be imported by server components/pages —
 * never by a client component. The mutating action lives in
 * `returns-actions.ts` and client-safe constants/types in `returns-shared.ts`.
 */

/** Đọc queue đổi/trả cho admin: join tên store + số đơn Shopify, mới nhất trước. */
export async function listAdminReturns(
  filter: { storeId?: string; status?: string } = {},
): Promise<AdminReturnRow[]> {
  const conds = [];
  if (filter.storeId) conds.push(eq(schema.customerReturnRequests.storeId, filter.storeId));
  if (filter.status) conds.push(eq(schema.customerReturnRequests.status, filter.status));

  return db.select({
    id: schema.customerReturnRequests.id,
    storeName: schema.stores.name,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    shopifyCustomerId: schema.customerReturnRequests.shopifyCustomerId,
    reason: schema.customerReturnRequests.reason,
    note: schema.customerReturnRequests.note,
    status: schema.customerReturnRequests.status,
    adminNote: schema.customerReturnRequests.adminNote,
    createdAt: schema.customerReturnRequests.createdAt,
  }).from(schema.customerReturnRequests)
    .innerJoin(schema.stores, eq(schema.customerReturnRequests.storeId, schema.stores.id))
    .innerJoin(schema.shopifyOrders, eq(schema.customerReturnRequests.orderId, schema.shopifyOrders.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.customerReturnRequests.createdAt));
}
