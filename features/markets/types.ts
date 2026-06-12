export interface Market {
  handle: string;
  name: string;
  type: 'regional' | 'international';
  countries: string[];
  primaryCurrency: string;
  alternativeCurrencies: string[];
  primaryLanguage: string;
  alternativeLanguages: string[];
  enabled: boolean;
}

export interface MarketPriceAdjustment {
  type: 'percentage';
  value: number;
}

export interface ShippingRate {
  type: 'flat';
  price: number;
  currency: string;
}

export interface ShippingZone {
  countries: string[];
  rates: Record<string, ShippingRate>;
  /** Nhãn mô tả gốc (vd "Middle East — DHL 9 / FedEx H"). Chỉ dùng nội bộ để
   *  hiển thị dòng phụ + tra cứu mapping carrier — KHÔNG đẩy lên Shopify (Shopify
   *  chỉ nhận key zone = mã ngắn ME1/US1…). Undefined với zone chưa đặt mã. */
  label?: string;
}

export interface MarketShipping {
  zones: Record<string, ShippingZone>;
}

export interface MarketStoreOverride {
  storeId: string;
  marketHandle: string;
  priceAdjustment: MarketPriceAdjustment | null;
  shipping: MarketShipping | null;
}

export interface EffectiveMarket extends Market {
  priceAdjustment: MarketPriceAdjustment | null;
  shipping: MarketShipping | null;
}
