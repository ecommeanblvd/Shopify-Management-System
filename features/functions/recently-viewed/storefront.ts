/**
 * Recently Viewed storefront actions. Pure server functions (NOT
 * 'use server') so they're unit-testable and reusable from cron /
 * analytics queries later.
 *
 * Multi-store isolation: every read scopes by storeId. Event rows are
 * append-only — dedup happens at READ time so the audit trail stays
 * intact and a future "viewed N times" cohort metric is trivial.
 */

import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import type {
  RecentlyViewedIdentity, RecentlyViewedItem, RecentlyViewedSnapshot,
} from './types';

/** Validates the identity envelope. Throws on bad input so handlers can
 *  map to 400. `deviceId` is REQUIRED — email is optional metadata. */
export function assertIdentity(id: RecentlyViewedIdentity): void {
  if (!id.deviceId) {
    throw new Error('deviceId is required');
  }
  if (id.deviceId.length < 8 || id.deviceId.length > 64) {
    throw new Error('Invalid deviceId');
  }
  if (id.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(id.email)) {
    throw new Error('Invalid email format');
  }
}

/** Append-only insert. Returns the event id for the caller's optimistic
 *  UI. Snapshot fields are required — same trade-off as Wishlist: we
 *  store enough to render the carousel without a Shopify Storefront API
 *  fan-out at view time. */
export async function recordView(
  storeId: string,
  id: RecentlyViewedIdentity,
  snap: RecentlyViewedSnapshot,
): Promise<{ id: string }> {
  assertIdentity(id);
  if (!snap?.shopifyProductId || !snap.productTitle || !snap.productHandle) {
    throw new Error('snapshot.{shopifyProductId, productTitle, productHandle} required');
  }
  const [row] = await db
    .insert(schema.recentlyViewedEvents)
    .values({
      storeId,
      deviceId: id.deviceId,
      customerEmail: id.email ?? null,
      shopifyCustomerId: id.shopifyCustomerId ?? null,
      shopifyProductId: snap.shopifyProductId,
      shopifyVariantId: snap.shopifyVariantId ?? null,
      productTitle: snap.productTitle,
      productHandle: snap.productHandle,
      imageUrl: snap.imageUrl ?? null,
      priceAmount: snap.priceAmount !== undefined ? snap.priceAmount.toString() : null,
      priceCurrency: snap.priceCurrency ?? null,
    })
    .returning({ id: schema.recentlyViewedEvents.id });
  return { id: row!.id };
}

/** Returns the last N unique products viewed by this identity. Dedup
 *  uses a per-product latest-row pick via DISTINCT ON; the carousel
 *  gets a clean list ordered by recency. */
export async function listRecentForIdentity(
  storeId: string,
  id: RecentlyViewedIdentity,
  limit = 12,
): Promise<RecentlyViewedItem[]> {
  assertIdentity(id);
  // Prefer email-keyed history when the shopper is logged in — survives
  // device wipes. Fall back to device-keyed otherwise.
  const useEmail = !!id.email;
  const rows = await db.execute<{
    shopify_product_id: string;
    shopify_variant_id: string | null;
    product_title: string;
    product_handle: string;
    image_url: string | null;
    price_amount: string | null;
    price_currency: string | null;
    viewed_at: Date;
  }>(sql`
    SELECT DISTINCT ON (shopify_product_id)
           shopify_product_id, shopify_variant_id,
           product_title, product_handle, image_url,
           price_amount::text, price_currency,
           viewed_at
      FROM recently_viewed_events
     WHERE store_id = ${storeId}
       AND ${useEmail
         ? sql`customer_email = ${id.email}`
         : sql`device_id = ${id.deviceId}`}
     ORDER BY shopify_product_id, viewed_at DESC
     LIMIT ${limit * 4};
  `);
  // The DISTINCT ON gives us latest-per-product but in product-id order.
  // Re-sort by viewedAt DESC and trim to limit.
  return rows.rows
    .map((r) => ({
      shopifyProductId: r.shopify_product_id,
      shopifyVariantId: r.shopify_variant_id,
      productTitle: r.product_title,
      productHandle: r.product_handle,
      imageUrl: r.image_url,
      priceAmount: r.price_amount !== null ? Number(r.price_amount) : null,
      priceCurrency: r.price_currency,
      viewedAt: r.viewed_at,
    }))
    .sort((a, b) => b.viewedAt.getTime() - a.viewedAt.getTime())
    .slice(0, limit);
}

export async function getRecentlyViewedSummary(
  storeId: string,
): Promise<{ viewCount: number; uniqueProducts: number; uniqueDevices: number; last7Days: number }> {
  const totals = await db.execute<{
    view_count: string; unique_products: string; unique_devices: string; last_7_days: string;
  }>(sql`
    SELECT
      COUNT(*)::text                                                     AS view_count,
      COUNT(DISTINCT shopify_product_id)::text                           AS unique_products,
      COUNT(DISTINCT device_id)::text                                    AS unique_devices,
      SUM(CASE WHEN viewed_at > NOW() - INTERVAL '7 days' THEN 1 ELSE 0 END)::text AS last_7_days
    FROM recently_viewed_events
    WHERE store_id = ${storeId};
  `);
  const r = totals.rows[0];
  return {
    viewCount: Number(r?.view_count ?? '0'),
    uniqueProducts: Number(r?.unique_products ?? '0'),
    uniqueDevices: Number(r?.unique_devices ?? '0'),
    last7Days: Number(r?.last_7_days ?? '0'),
  };
}

export interface TopViewedProduct {
  productId: string;
  productTitle: string;
  productHandle: string;
  views: number;
}

export async function getTopViewedProducts(
  storeId: string, limit = 10,
): Promise<TopViewedProduct[]> {
  const rows = await db.execute<{
    shopify_product_id: string; product_title: string; product_handle: string; n: string;
  }>(sql`
    SELECT shopify_product_id,
           MAX(product_title)  AS product_title,
           MAX(product_handle) AS product_handle,
           COUNT(*)::text      AS n
      FROM recently_viewed_events
     WHERE store_id = ${storeId}
     GROUP BY shopify_product_id
     ORDER BY COUNT(*) DESC
     LIMIT ${limit};
  `);
  return rows.rows.map((r) => ({
    productId: r.shopify_product_id,
    productTitle: r.product_title,
    productHandle: r.product_handle,
    views: Number(r.n),
  }));
}

// Re-exports kept for future cron / cleanup jobs.
void and;
void desc;
void eq;
