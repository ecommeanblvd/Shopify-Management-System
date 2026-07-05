/** Domain Wishlist Page (db): build items + recommendations, remove item.
 *  Recommendations: seed từ shopify_products của các item trong wishlist (vendor/type/tags),
 *  loại chính các sản phẩm đã lưu, chạy scoreProducts. Không có seed → recommendations []. */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { scoreProducts, type CatalogProduct, type SeedSignals } from './recommend';
import { findCustomerWishlist } from './wishlist-identity';

export interface WishlistPageItem {
  shopifyProductId: string; variantId: string | null;
  productTitle: string; variantTitle: string | null; productHandle: string;
  imageUrl: string | null; price: string | null; currency: string | null;
  availableForSale: boolean | null; addedAt: string;
}
export interface WishlistPageRec {
  shopifyProductId: string; title: string; handle: string; vendor: string | null;
  imageUrl: string | null; price: string | null; currency: string | null; score: number;
}
export interface WishlistPageData { items: WishlistPageItem[]; recommendations: WishlistPageRec[]; }

function toCatalogProduct(r: typeof schema.shopifyProducts.$inferSelect): CatalogProduct {
  return {
    shopifyProductId: r.shopifyProductId, title: r.title, handle: r.handle,
    vendor: r.vendor, productType: r.productType, tags: r.tags ?? [],
    imageUrl: r.imageUrl, priceMin: r.priceMin, currency: r.currency,
    availableForSale: r.availableForSale, status: r.status, syncedAt: r.syncedAt,
  };
}

export async function getWishlistPage(storeId: string, customerId: string): Promise<WishlistPageData> {
  const match = await findCustomerWishlist(storeId, customerId);
  if (!match) return { items: [], recommendations: [] };

  const items = await db.select().from(schema.wishlistItems)
    .where(eq(schema.wishlistItems.wishlistId, match.wishlistId));

  const pageItems: WishlistPageItem[] = items.map((i) => ({
    shopifyProductId: i.shopifyProductId,
    variantId: i.shopifyVariantId,
    productTitle: i.productTitle,
    variantTitle: i.variantTitle,
    productHandle: i.productHandle,
    imageUrl: i.imageUrl,
    price: i.priceAmount,
    currency: i.priceCurrency,
    availableForSale: i.availableForSale,
    addedAt: i.addedAt.toISOString(),
  }));

  const seedProductIds = [...new Set(items.map((i) => i.shopifyProductId))];
  if (seedProductIds.length === 0) return { items: pageItems, recommendations: [] };

  // Seed signals từ catalog của các sản phẩm đã lưu (join shopify_products).
  const seedProducts = await db.select().from(schema.shopifyProducts).where(and(
    eq(schema.shopifyProducts.storeId, storeId),
    inArray(schema.shopifyProducts.shopifyProductId, seedProductIds),
  ));
  const seed: SeedSignals = {
    vendors: [...new Set(seedProducts.map((p) => p.vendor).filter((v): v is string => !!v))],
    productTypes: [...new Set(seedProducts.map((p) => p.productType).filter((v): v is string => !!v))],
    tags: [...new Set(seedProducts.flatMap((p) => p.tags ?? []))],
    excludeProductIds: seedProductIds,
  };
  if (seed.vendors.length === 0 && seed.productTypes.length === 0 && seed.tags.length === 0) {
    return { items: pageItems, recommendations: [] };
  }

  // Candidate pool: sản phẩm ACTIVE của store. N nhỏ (vài nghìn) — quét in-memory chấp nhận v1.
  const candidates = await db.select().from(schema.shopifyProducts).where(and(
    eq(schema.shopifyProducts.storeId, storeId),
    eq(schema.shopifyProducts.status, 'ACTIVE'),
  ));
  const scored = scoreProducts(seed, candidates.map(toCatalogProduct));

  const recommendations: WishlistPageRec[] = scored.map((s) => ({
    shopifyProductId: s.shopifyProductId, title: s.title, handle: s.handle, vendor: s.vendor,
    imageUrl: s.imageUrl, price: s.priceMin, currency: s.currency, score: s.score,
  }));
  return { items: pageItems, recommendations };
}

export async function removeWishlistItem(
  storeId: string, customerId: string, productId: string, variantId?: string,
): Promise<{ removed: boolean }> {
  const match = await findCustomerWishlist(storeId, customerId);
  if (!match) return { removed: false };
  await db.delete(schema.wishlistItems).where(and(
    eq(schema.wishlistItems.wishlistId, match.wishlistId),
    eq(schema.wishlistItems.shopifyProductId, productId),
    variantId
      ? eq(schema.wishlistItems.shopifyVariantId, variantId)
      : isNull(schema.wishlistItems.shopifyVariantId),
  ));
  await db.insert(schema.wishlistEvents).values({
    storeId, wishlistId: match.wishlistId, eventType: 'remove',
    payload: { productId, variantId, source: 'account_page' } as never,
  });
  return { removed: true };
}
