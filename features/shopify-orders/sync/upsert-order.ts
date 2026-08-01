import { and, eq, isNotNull, or } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { mapShopifyOrder } from './shopify-mapper';
import { orderContentFingerprint, detectEdit } from './order-fingerprint';
import type { ShopifyOrderPayload } from '../shopify-types';
import { ensureFulfillmentForOrder } from '@/features/fulfillment/ensure-fulfillment';

export type UpsertSource = 'webhook' | 'cron' | 'backfill';

/**
 * GraphQL trả customer.id dạng gid://shopify/Customer/N — normalize về N
 * để khớp customerIdExpr (raw_payload->'customer'->>'id') + index 0089.
 */
export function normalizeCustomerGid<T extends { customer?: { id?: string | null } | null }>(payload: T): T {
  const gid = payload.customer?.id;
  if (typeof gid === 'string') {
    const m = /^gid:\/\/shopify\/Customer\/(\d+)$/.exec(gid);
    if (m) return { ...payload, customer: { ...payload.customer, id: m[1] } };
  }
  return payload;
}

/**
 * Idempotently upsert a Shopify order, its lines, and its refunds in a single
 * transaction. Safe to call from any of the three sync channels — last write
 * wins on the order row, lines are DELETE+INSERT-replaced (Shopify renumbers
 * line ids on edits), and refunds dedup by shopify_refund_id.
 */
export async function upsertOrder(
  storeId: string,
  rawPayload: ShopifyOrderPayload,
  source: UpsertSource,
): Promise<string | null> {
  const payload = normalizeCustomerGid(rawPayload);
  const mapped = mapShopifyOrder(payload, storeId);

  // Cancel detection (spec §4e): the upsert below is last-write-wins, so the
  // previous cancelled state is gone after it runs. One cheap indexed select
  // (unique shopify_order_id) of the old timestamp before the upsert tells us
  // whether this payload flips the order null → cancelled.
  const [prev] = await db
    .select({
      id: schema.shopifyOrders.id,
      cancelledAtShopify: schema.shopifyOrders.cancelledAtShopify,
      contentFingerprint: schema.shopifyOrders.contentFingerprint,
      editedAt: schema.shopifyOrders.editedAt,
      editedAfterFulfilledAt: schema.shopifyOrders.editedAfterFulfilledAt,
    })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.shopifyOrderId, payload.id))
    .limit(1);
  const becameCancelled =
    mapped.order.cancelledAtShopify !== null && prev !== undefined && prev.cancelledAtShopify === null;

  // Phát hiện sửa nội dung (sub-project C): hash địa chỉ+line; đơn đã "lên vận đơn"
  // (có shipment với tracking/label) mà nội dung đổi → cảnh báo.
  const nextFingerprint = orderContentFingerprint({
    shipName: mapped.order.shipName, shipAddress1: mapped.order.shipAddress1,
    shipAddress2: mapped.order.shipAddress2, shipCity: mapped.order.shipCity,
    shipPostcode: mapped.order.shipPostcode, shipCountry: mapped.order.shipCountry,
    lines: mapped.lines.map((l) => ({ sku: l.sku, quantity: l.quantity })),
  });
  let isFulfilled = false;
  if (prev?.id) {
    const [ship] = await db.select({ id: schema.shipments.id })
      .from(schema.shipments)
      .where(and(
        eq(schema.shipments.orderId, prev.id),
        or(isNotNull(schema.shipments.trackingNumber), isNotNull(schema.shipments.labelCreatedAt)),
      ))
      .limit(1);
    isFulfilled = !!ship;
  }
  const editFlags = detectEdit({
    prevFingerprint: prev?.contentFingerprint ?? null,
    nextFingerprint, isFulfilled, now: new Date(),
    prevEditedAt: prev?.editedAt ?? null,
    prevEditedAfterFulfilledAt: prev?.editedAfterFulfilledAt ?? null,
  });

  let internalOrderId: string | undefined;

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.shopifyOrders)
      .values({
        ...mapped.order,
        rawPayload: payload,
        source,
        contentFingerprint: nextFingerprint,
        editedAt: editFlags.editedAt,
        editedAfterFulfilledAt: editFlags.editedAfterFulfilledAt,
      })
      .onConflictDoUpdate({
        target: schema.shopifyOrders.shopifyOrderId,
        set: {
          ...mapped.order,
          rawPayload: payload,
          source,
          syncedAt: new Date(),
          contentFingerprint: nextFingerprint,
          editedAt: editFlags.editedAt,
          editedAfterFulfilledAt: editFlags.editedAfterFulfilledAt,
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
        // DoUpdate (thay DoNothing cũ): refund sync TRƯỚC khi có breakdown giờ
        // re-sync là được lấp chi tiết ship/lines; amount/reason cũng refresh.
        .onConflictDoUpdate({
          target: schema.shopifyOrderRefunds.shopifyRefundId,
          set: {
            amount: refund.amount, reason: refund.reason,
            ...(refund.shippingAmount != null ? { shippingAmount: refund.shippingAmount } : {}),
            ...(refund.lines != null ? { lines: refund.lines } : {}),
          },
        });
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
