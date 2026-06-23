import { eq, and, isNull, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';

/** Picked lines of an order not yet assigned to any pack. */
export async function pickedUnassignedLines(orderId: string) {
  const [ful] = await db.select({ id: schema.orderFulfillment.id })
    .from(schema.orderFulfillment).where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return [];
  return db.select({
    id: schema.orderFulfillmentLines.id,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
  })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(and(
      eq(schema.orderFulfillmentLines.fulfillmentId, ful.id),
      eq(schema.orderFulfillmentLines.status, 'picked'),
      isNull(schema.orderFulfillmentLines.shipmentId),
    ));
}

/** Packs (shipments) for an order, each with its assigned lines. */
export async function listPacksForOrder(orderId: string) {
  const packs = await db.select({
    id: schema.shipments.id,
    code: schema.shipments.logUniqueCode,
    carrierKey: schema.shipments.carrierKey,
    packagingType: schema.shipments.packagingType,
    dimLengthCm: schema.shipments.dimLengthCm,
    dimWidthCm: schema.shipments.dimWidthCm,
    dimHeightCm: schema.shipments.dimHeightCm,
    actualWeightKg: schema.shipments.actualWeightKg,
    originHub: schema.shipments.originHub,
    trackingNumber: schema.shipments.trackingNumber,
    checkPackedAt: schema.shipments.checkPackedAt,
    labelCreatedAt: schema.shipments.labelCreatedAt,
    shopifyPushStatus: schema.shipments.shopifyPushStatus,
    shopifyPushError: schema.shipments.shopifyPushError,
    shopifyFulfillmentId: schema.shipments.shopifyFulfillmentId,
    deliveryStatus: schema.shipments.deliveryStatus,
    deliveredAt: schema.shipments.deliveredAt,
    trackDetail: schema.shipments.trackDetail,
    lastTrackedAt: schema.shipments.lastTrackedAt,
  })
    .from(schema.shipments)
    .where(eq(schema.shipments.orderId, orderId))
    .orderBy(schema.shipments.createdAt);

  if (packs.length === 0) return [];

  const lines = await db.select({
    id: schema.orderFulfillmentLines.id,
    shipmentId: schema.orderFulfillmentLines.shipmentId,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    status: schema.orderFulfillmentLines.status,
    productTitle: schema.shopifyOrderLines.productTitle,
  })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .where(inArray(schema.orderFulfillmentLines.shipmentId, packs.map((p) => p.id)));

  return packs.map((p) => ({ ...p, lines: lines.filter((l) => l.shipmentId === p.id) }));
}
