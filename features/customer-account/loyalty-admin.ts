import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type { AdminLoyaltyRow } from './loyalty-shared';

export type { AdminLoyaltyRow } from './loyalty-shared';

/**
 * Server-only DB read for the loyalty admin page. Imports `@/db/client`, so it
 * must ONLY be imported by server components/pages — never a client component.
 * Mutating actions live in `loyalty-actions.ts`; client-safe types in
 * `loyalty-shared.ts`.
 */

/** Đọc bảng tier loyalty cho admin: join tên store, cập nhật gần nhất trước. */
export async function listLoyalty(storeId?: string): Promise<AdminLoyaltyRow[]> {
  return db.select({
    id: schema.customerLoyalty.id,
    storeId: schema.customerLoyalty.storeId,
    storeName: schema.stores.name,
    shopifyCustomerId: schema.customerLoyalty.shopifyCustomerId,
    tier: schema.customerLoyalty.tier,
    note: schema.customerLoyalty.note,
    updatedAt: schema.customerLoyalty.updatedAt,
  }).from(schema.customerLoyalty)
    .innerJoin(schema.stores, eq(schema.customerLoyalty.storeId, schema.stores.id))
    .where(storeId ? eq(schema.customerLoyalty.storeId, storeId) : undefined)
    .orderBy(desc(schema.customerLoyalty.updatedAt));
}
