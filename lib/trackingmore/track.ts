/**
 * TrackingMore v4 — nguồn tracking DỰ PHÒNG đa hãng (FedEx/DHL/UPS/Aramex/SF…).
 * Dùng khi API hãng bị giới hạn/không truy cập được (403 thiếu quyền, 429 quota).
 * Bật bằng env TRACKINGMORE_API_KEY; không có key → caller bỏ qua fallback.
 *
 * Flow TrackingMore: tracking phải được ĐĂNG KÝ (create) trước, sau đó GET mới
 * có trạng thái — lần đầu gặp 1 mã sẽ create rồi trả 'unknown', lượt poll sau
 * có số thật.
 */
import type { DeliveryStatus } from '@/lib/fedex/track';

const BASE = 'https://api.trackingmore.com/v4';

/** carrierKey nội bộ → courier_code TrackingMore. Sửa map này khi thêm hãng. */
export const TRACKINGMORE_COURIER: Record<string, string> = {
  fedex: 'fedex',
  dhl: 'dhl',
  ups: 'ups',
  aramex: 'aramex',
  'sf-express': 'sf-express',
};

/** THUẦN: delivery_status TrackingMore → DeliveryStatus nội bộ. */
export function mapTrackingMoreStatus(s: string | null | undefined): DeliveryStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'delivered': return 'delivered';
    case 'transit':
    case 'pickup':
    case 'inforeceived': return 'in_transit';
    case 'undelivered':
    case 'exception': return 'exception';
    default: return 'unknown'; // pending | notfound | expired | lạ
  }
}

export function hasTrackingMoreKey(): boolean {
  return !!process.env.TRACKINGMORE_API_KEY;
}

interface TmGetResponse {
  meta?: { code?: number; message?: string };
  data?: Array<{
    tracking_number?: string;
    delivery_status?: string;
    latest_event?: string;
    latest_checkpoint_time?: string;
  }>;
}

async function tmFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.TRACKINGMORE_API_KEY;
  if (!key) throw new Error('no_trackingmore_key');
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'Tracking-Api-Key': key, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { meta?: { code?: number; message?: string } };
  if (!res.ok && res.status === 429) throw new Error('trackingmore_rate_limited');
  return body;
}

export interface FallbackTrackResult {
  status: DeliveryStatus;
  description: string | null;
  deliveredAt: Date | null;
}

/** Track 1 mã qua TrackingMore. Mã chưa đăng ký → create rồi trả 'unknown'. */
export async function trackViaTrackingMore(carrierKey: string, trackingNumber: string): Promise<FallbackTrackResult> {
  const courier = TRACKINGMORE_COURIER[carrierKey];
  if (!courier) throw new Error(`trackingmore: chưa map courier cho carrier '${carrierKey}'`);

  const got = await tmFetch<TmGetResponse>(`/trackings/get?tracking_numbers=${encodeURIComponent(trackingNumber)}&courier_code=${courier}`);
  const row = got.data?.find((d) => d.tracking_number === trackingNumber) ?? got.data?.[0];

  if (!row) {
    // Chưa đăng ký → create. 4101 (đã tồn tại) coi như ok.
    const created = await tmFetch<{ meta?: { code?: number; message?: string } }>(`/trackings/create`, {
      method: 'POST',
      body: JSON.stringify({ tracking_number: trackingNumber, courier_code: courier }),
    });
    const code = created.meta?.code ?? 0;
    if (code !== 200 && code !== 4101) {
      throw new Error(`trackingmore create ${code}: ${created.meta?.message ?? 'failed'}`);
    }
    return { status: 'unknown', description: 'Đã đăng ký TrackingMore — chờ lượt poll sau', deliveredAt: null };
  }

  const status = mapTrackingMoreStatus(row.delivery_status);
  const deliveredAt = status === 'delivered' && row.latest_checkpoint_time
    ? (isNaN(new Date(row.latest_checkpoint_time).getTime()) ? null : new Date(row.latest_checkpoint_time))
    : null;
  return {
    status,
    description: row.latest_event ? `${row.latest_event} (via TrackingMore)` : '(via TrackingMore)',
    deliveredAt,
  };
}
