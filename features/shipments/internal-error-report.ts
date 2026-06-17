/**
 * Report các đơn lỗi nội bộ (status='internal_error').
 * summariseInternalErrors thuần để TDD; listInternalErrors đọc sống từ DB.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface InternalErrorRow {
  shipmentId: string;
  orderNumber: string | null;
  carrierKey: string | null;
  deltaVnd: number;
  note: string | null;
}

export interface InternalErrorGroup {
  carrierKey: string | null;
  count: number;
  sumDeltaVnd: number;
}

export function summariseInternalErrors(rows: InternalErrorRow[]): InternalErrorGroup[] {
  const byCarrier = new Map<string, InternalErrorGroup>();
  const order: string[] = [];
  for (const r of rows) {
    const k = r.carrierKey ?? '?';
    let g = byCarrier.get(k);
    if (!g) { g = { carrierKey: r.carrierKey, count: 0, sumDeltaVnd: 0 }; byCarrier.set(k, g); order.push(k); }
    g.count += 1;
    g.sumDeltaVnd += r.deltaVnd;
  }
  return order.map((k) => byCarrier.get(k)!);
}

/** Đơn đã đánh dấu lỗi nội bộ (status='internal_error'), join lấy carrier + đơn + Δ. */
export async function listInternalErrors(): Promise<InternalErrorRow[]> {
  const rows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      orderNumber: schema.shopifyOrders.shopifyOrderNumber,
      carrierKey: schema.shipments.carrierKey,
      delta: schema.shipmentReconcileStatus.deltaVndAtReview,
      note: schema.shipmentReconcileStatus.note,
    })
    .from(schema.shipmentReconcileStatus)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentReconcileStatus.shipmentId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .where(eq(schema.shipmentReconcileStatus.status, 'internal_error'));
  return rows.map((r) => ({
    shipmentId: r.shipmentId,
    orderNumber: r.orderNumber ?? null,
    carrierKey: r.carrierKey,
    deltaVnd: r.delta != null ? Number(r.delta) : 0,
    note: r.note,
  }));
}
