/** Identity for a view event. Mirrors WishlistIdentity for consistency
 *  but `deviceId` is the only REQUIRED field — anonymous shoppers still
 *  get a useful "recently viewed" carousel keyed on their localStorage
 *  device id. */
export interface RecentlyViewedIdentity {
  deviceId: string;
  email?: string;
  shopifyCustomerId?: string;
}

export interface RecentlyViewedSnapshot {
  shopifyProductId: string;
  shopifyVariantId?: string;
  productTitle: string;
  productHandle: string;
  imageUrl?: string;
  priceAmount?: number;
  priceCurrency?: string;
}

/** A single deduplicated entry returned to the storefront — one row per
 *  product, keyed to the most recent view. The carousel renders these
 *  in `viewedAt` DESC order. */
export interface RecentlyViewedItem {
  shopifyProductId: string;
  shopifyVariantId: string | null;
  productTitle: string;
  productHandle: string;
  imageUrl: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  viewedAt: Date;
}
