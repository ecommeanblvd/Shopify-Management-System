import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { mapShopifyOrder } from './shopify-mapper';
import type { ShopifyOrderPayload } from '../shopify-types';
import { ensureFulfillmentForOrder } from '@/features/fulfillment/ensure-fulfillment';

export type UpsertSource = 'webhook' | 'cron' | 'backfill';

/**
 * Idempotently upsert a Shopify order, its lines, and its refunds in a single
 * transaction. Safe to call from any of the three sync channels — last write
 * wins on the order row, lines are DELETE+INSERT-replaced (Shopify renumbers
 * line ids on edits), and refunds dedup by shopify_refund_id.
 */
export async function upsertOrder(
  storeId: string,
  payload: ShopifyOrderPayload,
  source: UpsertSource,
): Promise<string | null> {
  const mapped = mapShopifyOrder(payload, storeId);

  // Cancel detection (spec §4e): the upsert below is last-write-wins, so the
  // previous cancelled state is gone after it runs. One cheap indexed select
  // (unique shopify_order_id) of the old timestamp before the upsert tells us
  // whether this payload flips the order null → cancelled.
  const [prev] = await db
    .select({ cancelledAtShopify: schema.shopifyOrders.cancelledAtShopify })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id))
    .limit(1);
  const becameCancelled =
    mapped.order.cancelledAtShopify !== null && prev !== undefined && prev.cancelledAtShopify === null;

  let internalOrderId: string | undefined;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.shopifyOrders)
      .values({
        ...mapped.order,
        rawPayload: payload,
        source,
      })
      .onConflictDoUpdate({
        target: schema.shopifyOrders.shopifyOrderId,
        set: {
          ...mapped.order,
          rawPayload: payload,
          source,
          syncedAt: new Date(),
        },
      })
      .returning({ id: schema.shopifyOrders.id });

    internalOrderId = row!.id;

    await tx.delete(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, row!.id));
    if (mapped.lines.length > 0) {
      await tx.insert(schema.shopifyOrderLines).values(
        mapped.lines.map((l) => ({ ...l, orderId: row!.id })),
      );
    }

    for (const refund of mapped.refunds) {
      await tx
        .insert(schema.shopifyOrderRefunds)
        .values({ ...refund, orderId: row!.id })
        .onConflictDoNothing({ target: schema.shopifyOrderRefunds.shopifyRefundId });
    }
  });

  if (internalOrderId) {
    // Best-effort: creating the fulfillment ops record must never break order
    // sync (the order itself is already committed above). Log and continue on
    // any failure — e.g. the fulfillment tables not yet migrated on this env,
    // or a transient error — so webhooks still return 2xx and orders keep flowing.
    try {
      await ensureFulfillmentForOrder(internalOrderId);
    } catch (err) {
      console.error(`ensureFulfillmentForOrder failed for order ${internalOrderId}:`, err);
    }

    // Order just became cancelled: release its reservations back to the
    // warehouse and hand them to the next waiting order. Best-effort — a
    // release failure must never break order sync (order already committed).
    if (becameCancelled) {
      try {
        const { releaseOrderAllocations } = await import('@/features/warehouse/release');
        await releaseOrderAllocations(internalOrderId);
      } catch (err) {
        console.error(`releaseOrderAllocations failed for order ${internalOrderId}:`, err);
      }
    }
  }
  return internalOrderId ?? null;
}
