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
  branding: {
    logoUrl: string | null;
    heroUrl: string | null;
    supportEmail: string | null;
    announcement: string | null;
  };
  modules: ConfigModule[];
}

export interface OrderRow { orderId: string; orderNumber: string; placedAt: string; total: string; currency: string; currentStage: string | null }
export interface TimelineStep { label: string; at: string | null }
export interface PublicTimeline { currentStage: string; currentStageLabel: string; nextStageLabel: string | null; steps: TimelineStep[] }

export const getConfig = () => smsFetch<AccountConfig>('/api/customer-account/config');
export const getOrders = () => smsFetch<{ orders: OrderRow[] }>('/api/customer-account/orders');
export const getTimeline = (orderId: string) => smsFetch<{ timeline: PublicTimeline }>(`/api/customer-account/orders/${orderId}/timeline`);
export const getLoyalty = () => smsFetch<{ tier: string | null; note?: string | null }>('/api/customer-account/loyalty');
