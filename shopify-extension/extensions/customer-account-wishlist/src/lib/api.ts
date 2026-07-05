declare const shopify: { sessionToken: { get(): Promise<string> }; settings: { backend_url?: string } };

// Toàn bộ store của MEAN trỏ về cùng một backend SMS, nên set sẵn URL này làm mặc định
// để extension chạy ngay sau deploy mà không bắt buộc phải điền setting trong editor
// (editor checkout hay lỗi tải). Ô setting `backend_url` vẫn override nếu cần đổi.
const DEFAULT_BACKEND_URL = 'https://shopify-management-system-production.up.railway.app';

async function smsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = (shopify.settings.backend_url ?? '').trim() || DEFAULT_BACKEND_URL;
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SMS ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export type ModuleKey = 'tracking' | 'wishlist';
export interface ConfigModule {
  key: ModuleKey;
  title: string | null;
  iconUrl: string | null;
}
export interface AccountConfig {
  enabled: boolean;
  branding: { logoUrl: string | null; heroUrl: string | null; supportEmail: string | null; announcement: string | null };
  modules: ConfigModule[];
}

export interface WishlistItem {
  shopifyProductId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  productHandle: string;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  availableForSale: boolean | null;
  addedAt: string;
}
export interface WishlistRec {
  shopifyProductId: string;
  title: string;
  handle: string;
  vendor: string | null;
  imageUrl: string | null;
  price: string | null;
  currency: string | null;
  score: number;
}
export interface WishlistData {
  items: WishlistItem[];
  recommendations: WishlistRec[];
}

export const getConfig = () => smsFetch<AccountConfig>('/api/customer-account/config');
export const getWishlist = () => smsFetch<WishlistData>('/api/customer-account/wishlist');
export const postRemove = (shopifyProductId: string, shopifyVariantId?: string) =>
  smsFetch<{ removed: boolean }>('/api/customer-account/wishlist/remove', {
    method: 'POST',
    body: JSON.stringify(shopifyVariantId ? { shopifyProductId, shopifyVariantId } : { shopifyProductId }),
  });
