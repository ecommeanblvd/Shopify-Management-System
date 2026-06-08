import { eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/**
 * Idempotently create the order_fulfillment record + one line per order line.
 * Safe to call on every sync — only inserts when missing. Does NOT touch lines
 * that already progressed. Lines start at 'pending_check'; the initial stock
 * check runs separately (checkStockForOrder) — lazily on first view or via a
 * manual trigger.
 */
export async function ensureFulfillmentForOrder(orderId: string): Promise<void> {
  const existing = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment)
    .where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (existing.length > 0) return; // already created — leave as-is

  const lines = await db.select({ id: schema.shopifyOrderLines.id, sku: schema.shopifyOrderLines.sku, qty: schema.shopifyOrderLines.quantity })
    .from(schema.shopifyOrderLines)
    .where(eq(schema.shopifyOrderLines.orderId, orderId));
  if (lines.length === 0) return;

  const [ful] = await db.insert(schema.orderFulfillment)
    .values({ orderId, status: 'received' }).returning({ id: schema.orderFulfillment.id });

  await db.insert(schema.orderFulfillmentLines).values(
    lines.map((l) => ({ fulfillmentId: ful.id, orderLineId: l.id, sku: l.sku, qty: l.qty, status: 'pending_check' as const })),
  );
}

/** One-time backfill for orders that predate this feature (skips cancelled). */
export async function backfillFulfillmentRecords(): Promise<number> {
  const orders = await db.select({ id: schema.shopifyOrders.id })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderFulfillment, eq(schema.orderFulfillment.orderId, schema.shopifyOrders.id))
    .where(sql`${schema.orderFulfillment.id} is null and ${schema.shopifyOrders.cancelledAtShopify} is null`);
  for (const o of orders) await ensureFulfillmentForOrder(o.id);
  return orders.length;
}
