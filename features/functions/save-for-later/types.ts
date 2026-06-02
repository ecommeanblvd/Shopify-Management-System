export interface SaveForLaterIdentity {
  deviceId: string;
  email?: string;
  shopifyCustomerId?: string;
}

export interface SaveForLaterSnapshot {
  shopifyProductId: string;
  shopifyVariantId?: string;
  productTitle: string;
  variantTitle?: string;
  productHandle: string;
  imageUrl?: string;
  priceAmount?: number;
  priceCurrency?: string;
  qty?: number;
}

export interface SaveForLaterItemRow {
  id: string;
  shopifyProductId: string;
  shopifyVariantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  productHandle: string;
  imageUrl: string | null;
  priceAmount: number | null;
  priceCurrency: string | null;
  qty: number;
  savedAt: Date;
}
