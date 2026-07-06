import { and, eq, inArray, isNull, ne, or, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { trackFedex, type DeliveryStatus } from '@/lib/fedex/track';
import { trackDhl } from '@/lib/dhl/track';
import { emitShipHoEvent } from './mmp-events';
import { deliveryStatusToEvent } from './mmp-events-map';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const TRACKERS = { fedex: trackFedex, dhl: trackDhl } as const;
type TrackableCarrier = keyof typeof TRACKERS;
const isTrackable = (c: string | null): c is TrackableCarrier => c === 'fedex' || c === 'dhl';

/** THUẦN: status đơn sau khi track. delivered → 'delivered'; nhưng KHÔNG hạ đơn
 *  đã 'billed'/'settled' (trạng thái tiền tệ cao hơn). Còn lại giữ nguyên. */
export function orderStatusAfterTrack(current: string, delivery: DeliveryStatus): string {
  if (delivery !== 'delivered') return current;
  if (current === 'billed' || current === 'settled') return current;
  return 'delivered';
}

export async function trackAndStoreShipHo(
  orderId: string,
): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }> {
  const [o] = await db
    .select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      source: schema.shipHoOrders.source,
      mmpRef: schema.shipHoOrders.mmpRef,
      tracking: schema.shipHoOrders.trackingNumber,
      carrier: schema.shipHoOrders.carrierKey,
      status: schema.shipHoOrders.status,
      deliveryStatus: schema.shipHoOrders.deliveryStatus,
    })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'order not found' };
  if (!isTrackable(o.carrier)) return { ok: false, error: 'unsupported carrier' };
  if (!o.tracking) return { ok: false, error: 'no tracking' };
  try {
    const r = await TRACKERS[o.carrier](o.tracking);
    await db.update(schema.shipHoOrders).set({
      deliveryStatus: r.status,
      deliveredAt: r.deliveredAt ?? undefined,
      lastTrackedAt: new Date(),
      status: orderStatusAfterTrack(o.status, r.status) as typeof o.status,
    }).where(eq(schema.shipHoOrders.id, orderId));
    if (r.status !== o.deliveryStatus) {
      const evt = deliveryStatusToEvent(r.status);
      await emitShipHoEvent(
        { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
        evt,
        evt === 'shipment.delivered' ? { deliveredAt: (r.deliveredAt ?? new Date()).toISOString() } : {},
      );
    }
    return { ok: true, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'track failed' };
  }
}

const FEDEX_DELAY_MS = 300;
const DHL_DELAY_MS = Number(process.env.DHL_TRACK_DELAY_MS ?? 5000);
const DHL_MAX_PER_RUN = Number(process.env.DHL_MAX_PER_RUN ?? 30);

/** Poll đơn ship hộ chưa giao (fedex/dhl, có tracking, tạo ≤45 ngày). DHL giãn
 *  nhịp + cap/lượt; thiếu key/429 → bỏ nhánh DHL, FedEx vẫn chạy. */
export async function trackPendingShipHo(
  opts?: { limit?: number },
): Promise<{ tracked: number; delivered: number; failed: number; skippedDhl: number }> {
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.shipHoOrders.id, carrier: schema.shipHoOrders.carrierKey })
    .from(schema.shipHoOrders)
    .where(and(
      inArray(schema.shipHoOrders.carrierKey, ['fedex', 'dhl']),
      sql`${schema.shipHoOrders.trackingNumber} is not null`,
      or(isNull(schema.shipHoOrders.deliveryStatus), ne(schema.shipHoOrders.deliveryStatus, 'delivered')),
      gte(schema.shipHoOrders.createdAt, cutoff),
    ))
    .orderBy(sql`${schema.shipHoOrders.lastTrackedAt} asc nulls first`)
    .limit(limit);

  const summary = { tracked: 0, delivered: 0, failed: 0, skippedDhl: 0 };
  let skipDhl = false;
  let dhlDone = 0;
  for (const r of rows) {
    const isDhl = r.carrier === 'dhl';
    if (isDhl && (skipDhl || dhlDone >= DHL_MAX_PER_RUN)) { summary.skippedDhl++; continue; }
    const res = await trackAndStoreShipHo(r.id);
    if (isDhl) dhlDone++;
    if (res.ok) {
      summary.tracked++;
      if (res.status === 'delivered') summary.delivered++;
    } else if (res.error === 'no_dhl_key') {
      skipDhl = true; summary.skippedDhl++;
    } else if (res.error === 'dhl_rate_limited') {
      skipDhl = true;
    } else if (res.error !== 'no tracking' && res.error !== 'unsupported carrier') {
      summary.failed++;
    }
    await sleep(isDhl ? DHL_DELAY_MS : FEDEX_DELAY_MS);
  }
  return summary;
}
