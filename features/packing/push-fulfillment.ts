import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken } from '@/lib/shopify/client';
import { getOrderFulfillmentOrders, createFulfillment } from '@/lib/shopify/fulfillment';
import { trackingCompany, buildFulfillmentLineItems } from './shopify-push';

/** Push a pack's fulfillment to Shopify. Never throws — records status on the
 *  shipment for retry. Atomically claims the pack (one winner) so concurrent
 *  calls cannot create duplicate Shopify fulfillments. */
export async function pushPackFulfillmentCore(packId: string): Promise<void> {
  // Atomic claim: flip to 'pending' only if not already pushed and not in-flight.
  // `is distinct from 'pending'` matches NULL (first push) and 'failed' (retry),
  // but not 'pending' (another push in-flight).
  const claimed = await db.update(schema.shipments)
    .set({ shopifyPushStatus: 'pending', updatedAt: sql`now()` })
    .where(and(
      eq(schema.shipments.id, packId),
      isNull(schema.shipments.shopifyFulfillmentId),
      sql`${schema.shipments.shopifyPushStatus} is distinct from 'pending'`,
    ))
    .returning({ id: schema.shipments.id });
  if (claimed.length === 0) return; // already pushed, or another push in-flight

  try {
    const [pack] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, packId)).limit(1);
    if (!pack) return;

    const [order] = await db.select({ shopifyOrderId: schema.shopifyOrders.shopifyOrderId, storeId: schema.shopifyOrders.storeId })
      .from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, pack.orderId)).limit(1);
    if (!order) throw new Error('Order not found');
    const [store] = await db.select({ shopDomain: schema.stores.shopDomain, apiVersion: schema.stores.apiVersion })
      .from(schema.stores).where(eq(schema.stores.id, order.storeId)).limit(1);
    if (!store) throw new Error('Store not found');

    const lines = await db.select({ shopifyLineId: schema.orderFulfillmentLines.shopifyLineId, qty: schema.orderFulfillmentLines.qty })
      .from(schema.orderFulfillmentLines).where(eq(schema.orderFulfillmentLines.shipmentId, packId));

    const token = await getStoreToken(order.storeId);
    const storeRef = { shopDomain: store.shopDomain, apiVersion: store.apiVersion, token };

    const fos = await getOrderFulfillmentOrders({ store: storeRef, orderGid: order.shopifyOrderId });
    const mapped = buildFulfillmentLineItems(fos, lines);
    if (!mapped.ok) throw new Error(mapped.error);

    const fulfillmentId = await createFulfillment({
      store: storeRef,
      lineItemsByFulfillmentOrder: mapped.lineItemsByFulfillmentOrder,
      trackingCompany: trackingCompany(pack.carrierKey),
      trackingNumber: pack.trackingNumber ?? '',
      notifyCustomer: true,
    });

    await db.update(schema.shipments)
      .set({ shopifyFulfillmentId: fulfillmentId, shopifyPushStatus: 'pushed', shopifyPushError: null, shopifyPushedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.shipments.id, packId));
  } catch (e) {
    try {
      await db.update(schema.shipments)
        .set({ shopifyPushStatus: 'failed', shopifyPushError: e instanceof Error ? e.message : String(e), updatedAt: sql`now()` })
        .where(eq(schema.shipments.id, packId));
    } catch (dbErr) {
      console.error('[pushPackFulfillmentCore] failed to record push failure', dbErr);
    }
  }
}
