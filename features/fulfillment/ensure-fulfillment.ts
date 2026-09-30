import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { trangThaiMoHoSo, trangThaiMoDong } from '@/features/warehouse/nen-giu-hang';

/**
 * Idempotently ensure the order_fulfillment record + one line per CURRENT
 * order line exist. Keyed by the STABLE shopifyLineId (NOT the volatile
 * internal order-line id, which is deleted+reinserted on every re-sync), so
 * fulfillment progress survives order updates. onConflictDoNothing preserves
 * any already-progressed line. New lines start at 'pending_check'.
 */
export async function ensureFulfillmentForOrder(orderId: string): Promise<void> {
  const lines = await db.select({
    shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
    sku: schema.shopifyOrderLines.sku,
    qty: schema.shopifyOrderLines.quantity,
  })
    .from(schema.shopifyOrderLines)
    .where(eq(schema.shopifyOrderLines.orderId, orderId));
  if (lines.length === 0) return;

  /* Đơn ĐÃ GIAO XONG bên Shopify mở hồ sơ thẳng ở `shipped`, không vào hàng đợi việc của kho
     (CEO 30/09/2026). Lượt nạp 3.238 đơn lịch sử 2025 đẩy 19 đơn đã giao vào `received` và 16
     đơn vào `ready_to_pick` — kho mở màn thấy việc phải bốc hàng cho đơn năm ngoái. */
  const [don] = await db.select({ trangThaiGiao: schema.shopifyOrders.fulfillmentStatus })
    .from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, orderId)).limit(1);
  const moHoSo = trangThaiMoHoSo(don?.trangThaiGiao);
  const moDong = trangThaiMoDong(don?.trangThaiGiao);

  const existing = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment)
    .where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);

  const fulId = existing[0]?.id ?? (
    await db.insert(schema.orderFulfillment).values({ orderId, status: moHoSo })
      .returning({ id: schema.orderFulfillment.id })
  )[0].id;

  await db.insert(schema.orderFulfillmentLines)
    .values(lines.map((l) => ({
      fulfillmentId: fulId,
      shopifyLineId: l.shopifyLineId,
      sku: l.sku,
      qty: l.qty,
      status: moDong,
    })))
    .onConflictDoNothing({
      target: [schema.orderFulfillmentLines.fulfillmentId, schema.orderFulfillmentLines.shopifyLineId],
    });

  // Auto-allocation (spec §4a): best-effort — không phá sync khi lỗi.
  try {
    const { allocateOrder } = await import('@/features/warehouse/allocate');
    await allocateOrder(orderId);
  } catch (err) {
    console.error(`allocateOrder failed for ${orderId}:`, err);
  }
}

/** One-time backfill for orders that predate this feature (skips cancelled). */
export async function backfillFulfillmentRecords(): Promise<number> {
  const orders = await db.select({ id: schema.shopifyOrders.id })
    .from(schema.shopifyOrders)
    .where(sql`${schema.shopifyOrders.cancelledAtShopify} is null`);
  for (const o of orders) await ensureFulfillmentForOrder(o.id);
  return orders.length;
}
