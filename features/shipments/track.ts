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
  /** Đơn DHL bị bỏ trong lượt này (thiếu key / đã đạt cap / 429). */
  skippedDhl: number;
}

// DHL Unified Tracking tier khởi tạo: 250 lượt/ngày, 1 lượt/5s. Giãn nhịp riêng
// cho DHL (mặc định 5s) + cap mỗi lượt để không vượt quota (chỉnh qua env khi
// nâng tier production). FedEx giữ 300ms.
const FEDEX_DELAY_MS = 300;
const DHL_DELAY_MS = Number(process.env.DHL_TRACK_DELAY_MS ?? 5000);
const DHL_MAX_PER_RUN = Number(process.env.DHL_MAX_PER_RUN ?? 30);

/**
 * Poll các shipment CHƯA giao của hãng track được (FedEx + DHL), label/tạo ≤45
 * ngày, ưu tiên đơn lâu chưa track nhất. FedEx 300ms; DHL giãn 5s + cap/lượt cho
 * hợp tier free. Thiếu DHL key → bỏ qua đơn DHL (không lỗi); FedEx vẫn chạy.
 * 429 DHL → ngừng nhánh DHL lượt này.
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
      // Recency theo created_at (thời điểm tạo row — luôn set & đáng tin). KHÔNG
      // dùng label_created_at: DHL để giá trị rác (2025..2026-12-31) → coalesce sai.
      gte(schema.shipments.createdAt, cutoff),
    ))
    .orderBy(sql`${schema.shipments.lastTrackedAt} asc nulls first`)
    .limit(limit);

  const summary: TrackPendingSummary = { tracked: 0, delivered: 0, failed: 0, skippedDhl: 0 };
  let skipDhl = false; // bật khi thiếu key hoặc 429 → khỏi thử DHL nữa lượt này
  let dhlDone = 0;
  for (const r of rows) {
    const isDhl = r.carrier === 'dhl';
    if (isDhl && (skipDhl || dhlDone >= DHL_MAX_PER_RUN)) { summary.skippedDhl++; continue; }
    const res = await trackAndStoreShipment(r.id);
    if (isDhl) dhlDone++;
    if (res.ok) {
      summary.tracked++;
      if (res.status === 'delivered') summary.delivered++;
    } else if (res.error === 'no_dhl_key') {
      skipDhl = true; summary.skippedDhl++;
    } else if (res.error === 'dhl_rate_limited') {
      skipDhl = true; // tránh ban, dừng DHL; FedEx tiếp
    } else if (res.error !== 'no tracking' && res.error !== 'unsupported carrier') {
      summary.failed++;
    }
    await sleep(isDhl ? DHL_DELAY_MS : FEDEX_DELAY_MS);
  }
  return summary;
}
