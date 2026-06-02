export interface CreateRegistryInput {
  ownerEmail: string;
  ownerName?: string;
  eventName: string;
  /** ISO date string (YYYY-MM-DD). Optional — open registries are allowed. */
  eventDate?: string;
  message?: string;
}

export interface GiftRegistryRow {
  id: string;
  storeId: string;
  ownerEmail: string;
  ownerName: string | null;
  eventName: string;
  eventDate: string | null;
  message: string | null;
  shareToken: string;
  createdAt: Date;
}

export interface GiftRegistryItemSnapshot {
  shopifyProductId: string;
  shopifyVariantId?: string;
  productTitle: string;
  variantTitle?: string;
  productHandle: string;
  imageUrl?: string;
  priceAmount?: number;
  priceCurrency?: string;
  qtyWanted?: number;
  notes?: string;
}

export interface GiftRegistryItemRow {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  productHandle: string;
  imageUrl: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  qtyWanted: number;
  qtyReserved: number;
  notes: string | null;
}

export interface GiftRegistryReservationInput {
  reserverName: string;
  reserverEmail: string;
  qty?: number;
  message?: string;
}

export interface GiftRegistryReservationRow {
  id: string;
  itemId: string;
  reserverName: string;
  /** Email is REDACTED in the public viewer ("ja***@example.com") so
   *  the owner can see who reserved without exposing addresses to the
   *  wider internet. */
  reserverEmailRedacted: string;
  qty: number;
  message: string | null;
  status: 'reserved' | 'purchased' | 'cancelled';
  createdAt: Date;
}

export interface PublicRegistryView {
  registry: {
    eventName: string;
    eventDate: string | null;
    message: string | null;
    ownerName: string | null;
    storeName: string;
    shopDomain: string;
  };
  items: GiftRegistryItemRow[];
  reservations: GiftRegistryReservationRow[];
}
