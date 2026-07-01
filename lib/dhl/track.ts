/**
 * DHL Express — Shipment Tracking (Unified) API client + parser thuần.
 *
 * Cấu hình qua env (đặt trên Railway, KHÔNG commit):
 *   DHL_API_KEY — API key của app DHL developer portal (header DHL-API-Key).
 *                 (fallback: DHL_TRACK_API_KEY). SECRET của app KHÔNG cần cho
 *                 Unified Tracking.
 *   DHL_API_BASE — mặc định https://api-eu.dhl.com (fallback DHL_TRACK_API_BASE).
 *
 * Trả cùng shape với FedEx (`FedexTrackResult`) để `trackAndStoreShipment`
 * xử lý đồng nhất. Phần map/parse là THUẦN (test được); chỉ `trackDhl` chạm mạng.
 */
import type { DeliveryStatus } from '@/lib/fedex/track';

const DEFAULT_BASE = 'https://api-eu.dhl.com';
const OUT_FOR_DELIVERY_RE = /out for delivery|with delivery courier|being delivered/i;

export interface DhlTrackResult {
  statusCode: string | null;
  status: DeliveryStatus;
  description: string | null;
  deliveredAt: Date | null;
}

/** DHL Unified `status.statusCode` → DeliveryStatus của hệ thống. THUẦN. */
export function mapDhlStatus(statusCode: string | null | undefined, description: string | null | undefined): DeliveryStatus {
  switch ((statusCode ?? '').toLowerCase()) {
    case 'delivered': return 'delivered';
    case 'failure': return 'exception';
    case 'transit': return description && OUT_FOR_DELIVERY_RE.test(description) ? 'out_for_delivery' : 'in_transit';
    case 'pre-transit': return 'in_transit';
    default: return 'unknown';
  }
}

interface DhlRaw {
  shipments?: Array<{
    status?: { statusCode?: string | null; status?: string | null; description?: string | null; timestamp?: string | null };
  }>;
}

/** Parse phản hồi DHL Unified Tracking → DhlTrackResult. THUẦN, không nổ với input thiếu. */
export function parseDhlTrack(raw: unknown): DhlTrackResult {
  const st = (raw as DhlRaw | null)?.shipments?.[0]?.status;
  if (!st) return { statusCode: null, status: 'unknown', description: null, deliveredAt: null };
  const statusCode = st.statusCode ?? null;
  const description = st.description ?? st.status ?? null;
  const status = mapDhlStatus(statusCode, description);
  let deliveredAt: Date | null = null;
  if (status === 'delivered' && st.timestamp) {
    const d = new Date(st.timestamp);
    if (!Number.isNaN(d.getTime())) deliveredAt = d;
  }
  return { statusCode, status, description, deliveredAt };
}

/** Gọi DHL Unified Tracking cho 1 tracking number. Chạm mạng. */
export async function trackDhl(trackingNumber: string): Promise<DhlTrackResult> {
  // Chấp nhận cả DHL_API_KEY (tên đặt trên Railway) lẫn DHL_TRACK_API_KEY (tên cũ).
  const key = process.env.DHL_API_KEY || process.env.DHL_TRACK_API_KEY;
  if (!key) throw new Error('no_dhl_key');
  const base = process.env.DHL_API_BASE || process.env.DHL_TRACK_API_BASE || DEFAULT_BASE;
  const url = `${base}/track/shipments?trackingNumber=${encodeURIComponent(trackingNumber)}&service=express`;
  const res = await fetch(url, { headers: { 'DHL-API-Key': key, Accept: 'application/json' } });
  if (res.status === 404) return { statusCode: null, status: 'unknown', description: null, deliveredAt: null };
  if (res.status === 429) throw new Error('dhl_rate_limited');
  if (!res.ok) throw new Error(`dhl_track_http_${res.status}`);
  return parseDhlTrack(await res.json());
}
