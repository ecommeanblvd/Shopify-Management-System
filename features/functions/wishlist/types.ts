/** Identity options for a wishlist lookup / mutation. Exactly one of
 *  `email` or `deviceId` must be present. Email-keyed wishlists survive
 *  device wipes; device-keyed wishlists are guest fallback. */
export interface WishlistIdentity {
  email?: string;
  deviceId?: string;
  /** Shopify customer GID when the storefront script can resolve it.
   *  Stored alongside the email for later reconciliation with Shopify's
   *  customer-level analytics; not the primary identity. */
  shopifyCustomerId?: string;
}

export interface WishlistItemSnapshot {
  shopifyProductId: string;
  shopifyVariantId?: string;
  productTitle: string;
  variantTitle?: string;
  productHandle: string;
  imageUrl?: string;
  priceAmount?: number;
  priceCurrency?: string;
}

export interface WishlistRow {
  id: string;
  storeId: string;
  customerEmail: string | null;
  deviceId: string | null;
  itemCount: number;
}

export interface WishlistItemRow {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  productHandle: string;
  imageUrl: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  addedAt: Date;
}
