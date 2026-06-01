'use server';

import { and, eq, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export interface StoreFunctionStatus {
  storeId: string;
  shopDomain: string;
  storeName: string;
  enabled: boolean;
  updatedAt: Date | null;
}

/** Returns every store with its wishlist activation status. Drives the
 *  admin per-store toggle table. */
export async function listWishlistStatusPerStore(): Promise<StoreFunctionStatus[]> {
  const rows = await db.execute<{
    id: string;
    shop_domain: string;
    name: string;
    enabled: boolean | null;
    updated_at: Date | null;
  }>(sql`
    SELECT s.id, s.shop_domain, s.name,
           sfs.enabled,
           sfs.updated_at
      FROM stores s
      LEFT JOIN store_function_settings sfs
        ON sfs.store_id = s.id AND sfs.function_key = 'wishlist'
     ORDER BY s.name;
  `);
  return rows.rows.map((r) => ({
    storeId: r.id,
    shopDomain: r.shop_domain,
    storeName: r.name,
    enabled: r.enabled ?? false,
    updatedAt: r.updated_at,
  }));
}

export async function setWishlistEnabled(
  storeId: string, enabled: boolean,
): Promise<void> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'manage_functions')) {
    throw new Error('forbidden');
  }
  await db
    .insert(schema.storeFunctionSettings)
    .values({
      storeId,
      functionKey: 'wishlist',
      enabled,
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.storeFunctionSettings.storeId, schema.storeFunctionSettings.functionKey],
      set: { enabled, updatedBy: session.user.id, updatedAt: new Date() },
    });
  revalidatePath('/f/functions/wishlist');
  revalidatePath('/f/functions');
}

export interface WishlistSummaryForStore {
  shopperCount: number;
  itemCount: number;
  recentEvents: number;
}

/** Roll-up metrics for the per-store wishlist landing page. */
export async function getWishlistSummary(storeId: string): Promise<WishlistSummaryForStore> {
  const wlCount = await db
    .select({ id: schema.wishlists.id })
    .from(schema.wishlists)
    .where(eq(schema.wishlists.storeId, storeId));
  const items = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
      FROM wishlist_items i
      JOIN wishlists w ON w.id = i.wishlist_id
     WHERE w.store_id = ${storeId};
  `);
  const recent = await db.execute<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n
      FROM wishlist_events
     WHERE store_id = ${storeId}
       AND created_at > NOW() - INTERVAL '7 days';
  `);
  return {
    shopperCount: wlCount.length,
    itemCount: Number(items.rows[0]?.n ?? '0'),
    recentEvents: Number(recent.rows[0]?.n ?? '0'),
  };
}

export interface TopWishlistedProduct {
  productId: string;
  productTitle: string;
  productHandle: string;
  count: number;
}

export async function getTopWishlistedProducts(
  storeId: string, limit = 10,
): Promise<TopWishlistedProduct[]> {
  const rows = await db.execute<{
    shopify_product_id: string; product_title: string; product_handle: string; n: string;
  }>(sql`
    SELECT i.shopify_product_id,
           MAX(i.product_title)  AS product_title,
           MAX(i.product_handle) AS product_handle,
           COUNT(*)::text        AS n
      FROM wishlist_items i
      JOIN wishlists w ON w.id = i.wishlist_id
     WHERE w.store_id = ${storeId}
     GROUP BY i.shopify_product_id
     ORDER BY COUNT(*) DESC
     LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    productId: r.shopify_product_id,
    productTitle: r.product_title,
    productHandle: r.product_handle,
    count: Number(r.n),
  }));
}

// Silence unused-import warnings for helpers kept available to extend later.
void and;
