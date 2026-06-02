/**
 * Save-for-later storefront actions. Pure server functions so they're
 * unit-testable and reusable. Multi-store isolation: every query
 * filters by storeId; cross-store leaks would require a bug here.
 */

import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type {
  SaveForLaterIdentity, SaveForLaterItemRow, SaveForLaterSnapshot,
} from './types';

export function assertIdentity(id: SaveForLaterIdentity): void {
  if (!id.deviceId) throw new Error('deviceId is required');
  if (id.deviceId.length < 8 || id.deviceId.length > 64) {
    throw new Error('Invalid deviceId');
  }
  if (id.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id.email)) {
    throw new Error('Invalid email format');
  }
}

/** Save (or refresh) an item. Idempotent via the unique index:
 *  re-saving the same product bumps savedAt without creating a dupe. */
export async function saveItem(
  storeId: string, id: SaveForLaterIdentity, snap: SaveForLaterSnapshot,
): Promise<{ id: string; alreadyExisted: boolean }> {
  assertIdentity(id);
  if (!snap?.shopifyProductId || !snap.productTitle || !snap.productHandle) {
    throw new Error('snapshot.{shopifyProductId, productTitle, productHandle} required');
  }
  const qty = snap.qty ?? 1;
  if (!Number.isInteger(qty) || qty < 1 || qty > 99) {
    throw new Error('qty must be 1-99');
  }
  const result = await db
    .insert(schema.saveForLaterItems)
    .values({
      storeId,
      deviceId: id.deviceId,
      customerEmail: id.email ?? null,
      shopifyCustomerId: id.shopifyCustomerId ?? null,
      shopifyProductId: snap.shopifyProductId,
      shopifyVariantId: snap.shopifyVariantId ?? null,
      productTitle: snap.productTitle,
      variantTitle: snap.variantTitle ?? null,
      productHandle: snap.productHandle,
      imageUrl: snap.imageUrl ?? null,
      priceAmount: snap.priceAmount !== undefined ? snap.priceAmount.toString() : null,
      priceCurrency: snap.priceCurrency ?? null,
      qty,
    })
    .onConflictDoUpdate({
      target: [
        schema.saveForLaterItems.storeId,
        schema.saveForLaterItems.deviceId,
        schema.saveForLaterItems.shopifyProductId,
        // COALESCE-keyed unique index has no direct Drizzle handle for
        // `set`, so we update on the natural key. Both NULL and concrete
        // variant ids round-trip correctly here.
        schema.saveForLaterItems.shopifyVariantId,
      ],
      set: {
        qty,
        savedAt: new Date(),
        customerEmail: id.email ?? null,
        shopifyCustomerId: id.shopifyCustomerId ?? null,
      },
    })
    .returning({ id: schema.saveForLaterItems.id });
  return { id: result[0]!.id, alreadyExisted: false };
}

/** Lists the shopper's saved items, newest first. Filters by device id
 *  (the stable browser identity); email upgrade is purely metadata. */
export async function listSavedItems(
  storeId: string, id: SaveForLaterIdentity, limit = 50,
): Promise<SaveForLaterItemRow[]> {
  assertIdentity(id);
  const rows = await db
    .select()
    .from(schema.saveForLaterItems)
    .where(and(
      eq(schema.saveForLaterItems.storeId, storeId),
      eq(schema.saveForLaterItems.deviceId, id.deviceId),
    ))
    .orderBy(desc(schema.saveForLaterItems.savedAt))
    .limit(limit);
  return rows.map(mapRow);
}

function mapRow(r: typeof schema.saveForLaterItems.$inferSelect): SaveForLaterItemRow {
  return {
    id: r.id,
    shopifyProductId: r.shopifyProductId,
    shopifyVariantId: r.shopifyVariantId,
    productTitle: r.productTitle,
    variantTitle: r.variantTitle,
    productHandle: r.productHandle,
    imageUrl: r.imageUrl,
    priceAmount: r.priceAmount !== null ? Number(r.priceAmount) : null,
    priceCurrency: r.priceCurrency,
    qty: r.qty,
    savedAt: r.savedAt,
  };
}

/** Remove a single saved item by id (only the row owner — device id
 *  must match). Used by the storefront after "move back to cart" or
 *  explicit dismiss. */
export async function removeSavedItem(
  storeId: string, id: SaveForLaterIdentity, itemId: string,
): Promise<{ removed: boolean }> {
  assertIdentity(id);
  const result = await db
    .delete(schema.saveForLaterItems)
    .where(and(
      eq(schema.saveForLaterItems.id, itemId),
      eq(schema.saveForLaterItems.storeId, storeId),
      eq(schema.saveForLaterItems.deviceId, id.deviceId),
    ))
    .returning({ id: schema.saveForLaterItems.id });
  return { removed: result.length > 0 };
}

// Re-exports kept available for future cron / analytics queries.
void or; void isNull; void sql;
