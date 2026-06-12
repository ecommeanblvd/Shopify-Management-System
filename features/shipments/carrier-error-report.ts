/**
 * Report các đơn đã DUYỆT là lỗi carrier (status='carrier_error'). Không có
 * bảng report riêng — đọc sống từ shipment_reconcile_status (snapshot delta).
 * summariseCarrierErrors là thuần để TDD.
 */
import { db, schema } from '@/db/client';
import { desc, eq } from 'drizzle-orm';
import { CARRIER_ERROR_KINDS } from './carrier-error-kinds';

export interface CarrierErrorRow {
  shipmentId: string;
  carrierKey: string | null;
  orderName: string | null;
  tracking: string | null;
  shipCountry: string | null;
  labelDate: Date | null;
  kind: string;
  note: string;
  billedVnd: number | null;
  deltaVnd: number | null;
  approvedByName: string | null;
  approvedAt: Date;
}

export interface CarrierErrorGroup {
  carrierKey: string | null;
  count: number;
  sumDeltaVnd: number;
  byKind: Array<{ kind: string; count: number; sumDeltaVnd: number }>;
}

const KIND_ORDER: string[] = CARRIER_ERROR_KINDS.map((k) => k.value);

/** Gom theo carrier (thứ tự xuất hiện đầu), rồi theo kind (thứ tự CARRIER_ERROR_KINDS). */
export function summariseCarrierErrors(rows: CarrierErrorRow[]): CarrierErrorGroup[] {
  const byCarrier = new Map<string | null, CarrierErrorRow[]>();
  for (const r of rows) {
    const list = byCarrier.get(r.carrierKey) ?? [];
    list.push(r);
    byCarrier.set(r.carrierKey, list);
  }
  const out: CarrierErrorGroup[] = [];
  for (const [carrierKey, list] of byCarrier) {
    const kindMap = new Map<string, { count: number; sumDeltaVnd: number }>();
    let sum = 0;
    for (const r of list) {
      const d = r.deltaVnd ?? 0;
      sum += d;
      const k = kindMap.get(r.kind) ?? { count: 0, sumDeltaVnd: 0 };
      k.count += 1;
      k.sumDeltaVnd += d;
      kindMap.set(r.kind, k);
    }
    const byKind = [...kindMap.entries()]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => {
        const ia = KIND_ORDER.indexOf(a.kind), ib = KIND_ORDER.indexOf(b.kind);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      });
    out.push({ carrierKey, count: list.length, sumDeltaVnd: sum, byKind });
  }
  return out;
}

/** Đọc các đơn đã duyệt lỗi carrier — join shipments/orders/user. */
export async function listCarrierErrors(): Promise<CarrierErrorRow[]> {
  const rows = await db
    .select({
      shipmentId: schema.shipmentReconcileStatus.shipmentId,
      carrierKey: schema.shipments.carrierKey,
      orderName: schema.shopifyOrders.shopifyOrderNumber,
      tracking: schema.shipments.trackingNumber,
      shipCountry: schema.shopifyOrders.shipCountry,
      labelDate: schema.shipments.labelCreatedAt,
      kind: schema.shipmentReconcileStatus.carrierErrorKind,
      note: schema.shipmentReconcileStatus.note,
      billedVnd: schema.shipmentReconcileStatus.billedTotalAtReview,
      deltaVnd: schema.shipmentReconcileStatus.deltaVndAtReview,
      approvedByName: schema.user.name,
      approvedAt: schema.shipmentReconcileStatus.reconciledAt,
    })
    .from(schema.shipmentReconcileStatus)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentReconcileStatus.shipmentId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.shipments.orderId))
    .leftJoin(schema.user, eq(schema.user.id, schema.shipmentReconcileStatus.reconciledBy))
    .where(eq(schema.shipmentReconcileStatus.status, 'carrier_error'))
    .orderBy(desc(schema.shipmentReconcileStatus.reconciledAt));
  return rows.map((r) => ({
    shipmentId: r.shipmentId,
    carrierKey: r.carrierKey,
    orderName: r.orderName ?? null,
    tracking: r.tracking ?? null,
    shipCountry: r.shipCountry ?? null,
    labelDate: r.labelDate ?? null,
    kind: r.kind ?? 'other',
    note: r.note ?? '',
    billedVnd: r.billedVnd !== null ? Number(r.billedVnd) : null,
    deltaVnd: r.deltaVnd !== null ? Number(r.deltaVnd) : null,
    approvedByName: r.approvedByName ?? null,
    approvedAt: r.approvedAt,
  }));
}
