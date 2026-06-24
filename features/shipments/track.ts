import { and, eq, isNull, ne, or, gte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { trackFedex, type DeliveryStatus } from '@/lib/fedex/track';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function trackAndStoreShipment(
  shipmentId: string,
): Promise<{ ok: boolean; status?: DeliveryStatus; error?: string }> {
  const [s] = await db
    .select({ tracking: schema.shipments.trackingNumber, carrier: schema.shipments.carrierKey })
    .from(schema.shipments).where(eq(schema.shipments.id, shipmentId)).limit(1);
  if (!s) return { ok: false, error: 'shipment not found' };
  if (s.carrier !== 'fedex') return { ok: false, error: 'not fedex' };
  if (!s.tracking) return { ok: false, error: 'no tracking' };
  try {
    const r = await trackFedex(s.tracking);
    await db.update(schema.shipments).set({
      deliveryStatus: r.status,
      deliverySource: 'fedex',
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

/** Poll shipment FedEx chưa giao, label ≤45 ngày. Rate-limit 300ms. */
export async function trackPendingShipments(
  opts?: { limit?: number },
): Promise<{ tracked: number; delivered: number; failed: number }> {
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: schema.shipments.id })
    .from(schema.shipments)
    .where(and(
      eq(schema.shipments.carrierKey, 'fedex'),
      sql`${schema.shipments.trackingNumber} is not null`,
      or(isNull(schema.shipments.deliveryStatus), ne(schema.shipments.deliveryStatus, 'delivered')),
      gte(schema.shipments.labelCreatedAt, cutoff),
    ))
    .orderBy(sql`${schema.shipments.lastTrackedAt} asc nulls first`)
    .limit(limit);
  let tracked = 0, delivered = 0, failed = 0;
  for (const r of rows) {
    const res = await trackAndStoreShipment(r.id);
    if (res.ok) { tracked++; if (res.status === 'delivered') delivered++; }
    else if (res.error !== 'no tracking' && res.error !== 'not fedex') failed++;
    await sleep(300);
  }
  return { tracked, delivered, failed };
}
