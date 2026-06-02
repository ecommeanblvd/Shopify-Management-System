'use server';

import { sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';

export interface SaveForLaterStoreStatus {
  storeId: string;
  shopDomain: string;
  storeName: string;
  enabled: boolean;
  updatedAt: Date | null;
}

export async function listSaveForLaterStatusPerStore(): Promise<SaveForLaterStoreStatus[]> {
  const rows = await db.execute<{
    id: string; shop_domain: string; name: string;
    enabled: boolean | null; updated_at: Date | null;
  }>(sql`
    SELECT s.id, s.shop_domain, s.name,
           sfs.enabled,
           sfs.updated_at
      FROM stores s
      LEFT JOIN store_function_settings sfs
        ON sfs.store_id = s.id AND sfs.function_key = 'save-for-later'
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

export async function setSaveForLaterEnabled(
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
      functionKey: 'save-for-later',
      enabled,
      updatedBy: session.user.id,
    })
    .onConflictDoUpdate({
      target: [schema.storeFunctionSettings.storeId, schema.storeFunctionSettings.functionKey],
      set: { enabled, updatedBy: session.user.id, updatedAt: new Date() },
    });
  revalidatePath('/f/functions/save-for-later');
  revalidatePath('/f/functions');
}

export interface SaveForLaterSummary {
  itemCount: number;
  uniqueDevices: number;
  uniqueProducts: number;
  last7Days: number;
}

export async function getSaveForLaterSummary(storeId: string): Promise<SaveForLaterSummary> {
  const totals = await db.execute<{
    item_count: string; unique_devices: string;
    unique_products: string; last_7_days: string;
  }>(sql`
    SELECT
      COUNT(*)::text                                                          AS item_count,
      COUNT(DISTINCT device_id)::text                                         AS unique_devices,
      COUNT(DISTINCT shopify_product_id)::text                                AS unique_products,
      SUM(CASE WHEN saved_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::text AS last_7_days
    FROM save_for_later_items
    WHERE store_id = ${storeId};
  `);
  const r = totals.rows[0];
  return {
    itemCount: Number(r?.item_count ?? '0'),
    uniqueDevices: Number(r?.unique_devices ?? '0'),
    uniqueProducts: Number(r?.unique_products ?? '0'),
    last7Days: Number(r?.last_7_days ?? '0'),
  };
}

export interface TopSavedProduct {
  productId: string;
  productTitle: string;
  productHandle: string;
  saves: number;
}

export async function getTopSavedProducts(
  storeId: string, limit = 10,
): Promise<TopSavedProduct[]> {
  const rows = await db.execute<{
    shopify_product_id: string; product_title: string; product_handle: string; n: string;
  }>(sql`
    SELECT shopify_product_id,
           MAX(product_title)  AS product_title,
           MAX(product_handle) AS product_handle,
           COUNT(*)::text      AS n
      FROM save_for_later_items
     WHERE store_id = ${storeId}
     GROUP BY shopify_product_id
     ORDER BY COUNT(*) DESC
     LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    productId: r.shopify_product_id,
    productTitle: r.product_title,
    productHandle: r.product_handle,
    saves: Number(r.n),
  }));
}
