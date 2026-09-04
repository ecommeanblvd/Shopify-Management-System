/**
 * Track 1 mã qua nguồn TỐT NHẤT hiện có: API hãng (FedEx/DHL) là chính; nếu hãng
 * lỗi/giới hạn (403 thiếu quyền, 429 quota, thiếu key) → fallback TrackingMore
 * (khi có TRACKINGMORE_API_KEY). Dùng chung cho shipments + ship hộ.
 */
import { trackFedex, type DeliveryStatus } from '@/lib/fedex/track';
import { trackDhl } from '@/lib/dhl/track';
import { hasTrackingMoreKey, trackViaTrackingMore } from '@/lib/trackingmore/track';

export interface AnyTrackResult {
  status: DeliveryStatus;
  description: string | null;
  deliveredAt: Date | null;
  source: 'carrier' | 'trackingmore';
}

const CARRIER_TRACKERS: Record<string, (tn: string) => Promise<{ status: DeliveryStatus; description: string | null; deliveredAt: Date | null }>> = {
  fedex: trackFedex,
  dhl: trackDhl,
};

export function isTrackableCarrier(c: string | null): c is string {
  return !!c && (c in CARRIER_TRACKERS || hasTrackingMoreKey());
}

export async function trackAny(carrierKey: string, trackingNumber: string): Promise<AnyTrackResult> {
  const primary = CARRIER_TRACKERS[carrierKey];
  if (primary) {
    try {
      const r = await primary(trackingNumber);
      return { status: r.status, description: r.description, deliveredAt: r.deliveredAt, source: 'carrier' };
    } catch (e) {
      if (!hasTrackingMoreKey()) throw e; // không có fallback → nổi lỗi như cũ
      // Hãng lỗi (403/429/timeout…) → thử TrackingMore. Nếu fallback CŨNG lỗi thì
      // báo CẢ HAI lý do: trước đây chỉ ném lỗi của hãng nên lỗi của fallback bị
      // nuốt sạch — nhìn log tưởng chỉ FedEx hỏng, trong khi TrackingMore đã hết
      // quota từ lâu (bắt được 04/09, suýt chẩn đoán sai).
      try {
        const f = await trackViaTrackingMore(carrierKey, trackingNumber);
        return { ...f, source: 'trackingmore' };
      } catch (eFallback) {
        const loiHang = e instanceof Error ? e.message : String(e);
        const loiDuPhong = eFallback instanceof Error ? eFallback.message : String(eFallback);
        throw new Error(`cả hai nguồn tracking đều hỏng — ${carrierKey}: ${loiHang} | dự phòng: ${loiDuPhong}`);
      }
    }
  }
  // Hãng không có tracker riêng (ups/aramex/sf-express…) → TrackingMore là nguồn duy nhất.
  const f = await trackViaTrackingMore(carrierKey, trackingNumber);
  return { ...f, source: 'trackingmore' };
}
