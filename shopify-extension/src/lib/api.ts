import type { AccountConfig } from './render-plan';
declare const shopify: { sessionToken: { get(): Promise<string> }; settings: { backend_url?: string } };

async function smsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const base = shopify.settings.backend_url;
  if (!base) throw new Error('backend_url chưa cấu hình trong extension settings');
  const token = await shopify.sessionToken.get();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`SMS ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export interface OrderRow { orderId: string; orderNumber: string; placedAt: string; total: string; currency: string; currentStage: string | null }
export interface TimelineStep { label: string; at: string | null }
export interface PublicTimeline { currentStage: string; currentStageLabel: string; nextStageLabel: string | null; steps: TimelineStep[] }
export interface ReturnRow { id: string; orderId: string; orderNumber: string | null; reason: string; status: string; createdAt: string }

export const getConfig = () => smsFetch<AccountConfig>('/api/customer-account/config');
export const getOrders = () => smsFetch<{ orders: OrderRow[] }>('/api/customer-account/orders');
export const getTimeline = (orderId: string) => smsFetch<{ timeline: PublicTimeline }>(`/api/customer-account/orders/${orderId}/timeline`);
export const getLoyalty = () => smsFetch<{ tier: string | null; note?: string | null }>('/api/customer-account/loyalty');
export const getReturns = () => smsFetch<{ returns: ReturnRow[] }>('/api/customer-account/returns');
export const createReturn = (orderId: string, reason: string, note?: string) =>
  smsFetch<{ ok: boolean; id?: string; error?: string }>('/api/customer-account/returns', { method: 'POST', body: JSON.stringify({ orderId, reason, note }) });
