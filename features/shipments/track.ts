import { and, eq, inArray, isNull, ne, or, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { trackFedex, type DeliveryStatus } from '@/lib/fedex/track';
import { trackDhl } from '@/lib/dhl/track';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hãng đang hỗ trợ auto-track — mỗi hãng 1 client cùng shape kết quả. */
const TRACKERS = { fedex: trackFedex, dhl: trackDhl } as const;
type TrackableCarrier = keyof typeof TRACKERS;
const isTrackable = (c: string | null): c is TrackableCarrier => c === 'fedex' || c === 'dhl';

export async function trackAndStoreShipment(
  shipmentId: string,
): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }> {
  const [s] = await db
    .select({ tracking: schema.shipments.trackingNumber, carrier: schema.shipments.carrierKey })
    .from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!s) return { ok: false, error: 'shipment not found' };
  if (!isTrackable(s.carrier)) return { ok: false, error: 'unsupported carrier' };
  if (!s.tracking) return { ok: false, error: 'no tracking' };
  try {
    const r = await TRACKERS[s.carrier](s.tracking);
    await db.update(schema.shipments).set({
      deliveryStatus: r.status,
      deliverySource: s.carrier,
      trackDetail: r.description,
      deliveredAt: r.deliveredAt ?? undefined, // chỉ set khi có
      lastTrackedAt: new Date(),
      updatedAt: sql`now()`,
    }).where(eq(schema.shipments.id, shipmentId));
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'track failed' };
  }
}

export interface TrackPendingSummary {
  tracked: number;
  delivered: number;
  failed: number;
  /** Đơn DHL bị bỏ vì thiếu DHL_TRACK_API_KEY (quan sát cho tới khi có key). */
  skippedDhlNoKey: number;
}

/**
 * Poll các shipment CHƯA giao của hãng track được (FedEx + DHL), label/tạo ≤45
 * ngày, ưu tiên đơn lâu chưa track nhất. Rate-limit 300ms. Thiếu DHL key → bỏ
 * qua đơn DHL (không lỗi); FedEx vẫn chạy. 429 DHL → ngừng nhánh DHL lượt này.
 */
export async function trackPendingShipments(
  opts?: { limit?: number },
): Promise<TrackPendingSummary> {
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.shipments.id, carrier: schema.shipments.carrierKey })
    .from(schema.shipments)
    .where(and(
      inArray(schema.shipments.carrierKey, ['fedex', 'dhl']),
      sql`${schema.shipments.trackingNumber} is not null`,
      or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
      // DHL nhiều đơn thiếu label_created_at → coalesce sang created_at để không bỏ sót.
      gte(sql`coalesce(${schema.shipments.labelCreatedAt}, ${schema.shipments.createdAt})`, cutoff),
    ))
    .orderBy(sql`${schema.shipments.lastTrackedAt} asc nulls first`)
    .limit(limit);

  const summary: TrackPendingSummary = { tracked: 0, delivered: 0, failed: 0, skippedDhlNoKey: 0 };
  let skipDhl = false; // bật khi thiếu key hoặc 429 → khỏi thử DHL nữa lượt này
  for (const r of rows) {
    if (r.carrier === 'dhl' && skipDhl) { summary.skippedDhlNoKey++; continue; }
    const res = await trackAndStoreShipment(r.id);
    if (res.ok) {
      summary.tracked++;
      if (res.status === 'delivered') summary.delivered++;
    } else if (res.error === 'no_dhl_key') {
      skipDhl = true; summary.skippedDhlNoKey++;
    } else if (res.error === 'dhl_rate_limited') {
      skipDhl = true; // tránh ban, dừng DHL; FedEx tiếp
    } else if (res.error !== 'no tracking' && res.error !== 'unsupported carrier') {
      summary.failed++;
    }
    await sleep(300);
  }
  return summary;
}
