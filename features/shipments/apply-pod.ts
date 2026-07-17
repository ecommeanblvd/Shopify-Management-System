/**
 * Áp POD (bằng chứng giao hàng trên bill FedEx FBO) vào ngày giao thực tế.
 * POD là nguồn CHUẨN (quyết định 17/07): ghi đè delivered_at từ Lark nhập tay/
 * fallback khi lệch — chữa cả các đơn bị dồn ngày do first-seen fallback cũ.
 *
 * Idempotent: chỉ update dòng có khác biệt; chạy sau mỗi lần import bill + cron
 * hourly. Không đụng tracking API nào.
 */
import { sql, and, eq, isNotNull, ne, or, isNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { emitShipHoEvent } from '@/features/ship-ho/mmp-events';
import { orderStatusAfterTrack } from '@/features/ship-ho/track';

export interface ApplyPodSummary {
  shipmentsUpdated: number;
  shipHoUpdated: number;
  shipHoEvents: number;
}

export async function applyPodDeliveries(): Promise<ApplyPodSummary> {
  // ── shipments (đơn Shopify): set-based, POD ghi đè khi lệch/thiếu ──
  const res = await db.execute(sql`
    UPDATE shipments s
    SET delivered_at = bl.pod_at, delivery_source = 'carrier_bill'
    FROM (
      SELECT DISTINCT ON (tracking_number) tracking_number, pod_at
      FROM carrier_bill_lines
      WHERE pod_at IS NOT NULL AND tracking_number IS NOT NULL
      ORDER BY tracking_number, pod_at DESC
    ) bl
    WHERE s.tracking_number = bl.tracking_number
      AND (s.delivered_at IS DISTINCT FROM bl.pod_at OR s.delivery_source IS DISTINCT FROM 'carrier_bill')
  `);
  const shipmentsUpdated = res.rowCount ?? 0;

  // ── ship_ho_orders: từng đơn (cần bắn event MMP khi trạng thái đổi) ──
  const shipHo = await db
    .select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      source: schema.shipHoOrders.source,
      mmpRef: schema.shipHoOrders.mmpRef,
      status: schema.shipHoOrders.status,
      deliveryStatus: schema.shipHoOrders.deliveryStatus,
      deliveredAt: schema.shipHoOrders.deliveredAt,
      podAt: schema.carrierBillLines.podAt,
    })
    .from(schema.shipHoOrders)
    .innerJoin(
      schema.carrierBillLines,
      eq(schema.carrierBillLines.trackingNumber, schema.shipHoOrders.trackingNumber),
    )
    .where(and(
      isNotNull(schema.carrierBillLines.podAt),
      or(
        isNull(schema.shipHoOrders.deliveredAt),
        ne(schema.shipHoOrders.deliveryStatus, 'delivered'),
        sql`${schema.shipHoOrders.deliveredAt} IS DISTINCT FROM ${schema.carrierBillLines.podAt}`,
      ),
    ));

  let shipHoUpdated = 0;
  let shipHoEvents = 0;
  const seen = new Set<string>();
  for (const o of shipHo) {
    if (seen.has(o.id) || o.podAt == null) continue; // 1 đơn có thể khớp nhiều dòng bill
    seen.add(o.id);
    const wasDelivered = o.deliveryStatus === 'delivered';
    await db.update(schema.shipHoOrders).set({
      deliveryStatus: 'delivered',
      deliveredAt: o.podAt,
      // Không hạ đơn đã 'billed'/'settled' (trạng thái tiền tệ cao hơn).
      status: orderStatusAfterTrack(o.status, 'delivered') as typeof o.status,
    }).where(eq(schema.shipHoOrders.id, o.id));
    shipHoUpdated += 1;
    if (!wasDelivered) {
      await emitShipHoEvent(
        { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
        'shipment.delivered',
        { deliveredAt: o.podAt.toISOString(), source: 'carrier_bill' },
      );
      shipHoEvents += 1;
    }
  }

  return { shipmentsUpdated, shipHoUpdated, shipHoEvents };
}
