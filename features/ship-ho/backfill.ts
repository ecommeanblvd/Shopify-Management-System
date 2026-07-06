import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface BackfillOrder {
  mmpRef: string; code: string; status: string;
  trackingNumber?: string; deliveryStatus?: string; deliveredAt?: string; chargedVnd?: number;
}

/** THUẦN: map 1 đơn → shape backfill (bỏ field null, tiền→int, thời gian→ISO). */
export function mapOrderToBackfill(o: {
  mmpRef: string; code: string; status: string;
  trackingNumber?: string | null; deliveryStatus?: string | null; deliveredAt?: Date | null; chargedVnd?: string | null;
}): BackfillOrder {
  const r: BackfillOrder = { mmpRef: o.mmpRef, code: o.code, status: o.status };
  if (o.trackingNumber) r.trackingNumber = o.trackingNumber;
  if (o.deliveryStatus) r.deliveryStatus = o.deliveryStatus;
  if (o.deliveredAt) r.deliveredAt = o.deliveredAt.toISOString();
  if (o.chargedVnd != null) r.chargedVnd = Math.round(Number(o.chargedVnd));
  return r;
}

/** I/O: đơn source='mmp' có event occurred_at >= updatedSince (đã đổi). */
export async function getBackfillOrders(updatedSince: Date, brandSlug?: string): Promise<BackfillOrder[]> {
  const changed = await db.selectDistinct({ orderId: schema.shipHoOrderEvents.orderId })
    .from(schema.shipHoOrderEvents)
    .where(gte(schema.shipHoOrderEvents.occurredAt, updatedSince));
  const ids = changed.map((c) => c.orderId);
  if (ids.length === 0) return [];

  const conds = [eq(schema.shipHoOrders.source, 'mmp'), inArray(schema.shipHoOrders.id, ids)];
  if (brandSlug) conds.push(eq(schema.shipHoOrders.partnerBrandSlug, brandSlug));

  const rows = await db.select({
    mmpRef: schema.shipHoOrders.mmpRef, code: schema.shipHoOrders.code, status: schema.shipHoOrders.status,
    trackingNumber: schema.shipHoOrders.trackingNumber, deliveryStatus: schema.shipHoOrders.deliveryStatus,
    deliveredAt: schema.shipHoOrders.deliveredAt, chargedVnd: schema.shipHoOrders.chargedVnd,
  }).from(schema.shipHoOrders).where(and(...conds)).orderBy(desc(schema.shipHoOrders.createdAt)).limit(200);

  return rows.filter((r) => r.mmpRef).map((r) => mapOrderToBackfill({ ...r, mmpRef: r.mmpRef as string }));
}
