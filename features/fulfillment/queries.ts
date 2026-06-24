import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listFulfillmentWorklist() {
  return db.select({
    orderId: schema.orderFulfillment.orderId,
    status: schema.orderFulfillment.status,
    updatedAt: schema.orderFulfillment.updatedAt,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
    createdAtShopify: schema.shopifyOrders.createdAtShopify,
  })
    .from(schema.orderFulfillment)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .orderBy(desc(schema.shopifyOrders.createdAtShopify));
}

export async function getFulfillmentDetail(orderId: string) {
  const [ful] = await db.select().from(schema.orderFulfillment)
    .where(eq(schema.orderFulfillment.orderId, orderId)).limit(1);
  if (!ful) return null;
  const lines = await db.select({
    id: schema.orderFulfillmentLines.id,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    status: schema.orderFulfillmentLines.status,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
    warehouseInventoryId: schema.orderFulfillmentLines.warehouseInventoryId,
    warehouseCode: schema.warehouseInventory.warehouseCode,
    shelf: schema.warehouseInventory.shelf,
    floor: schema.warehouseInventory.floor,
    bin: schema.warehouseInventory.bin,
    brandRequestId: schema.brandOrderRequests.id,
    brandSendStatus: schema.brandOrderRequests.sendStatus,
    brandConfirmStatus: schema.brandOrderRequests.confirmStatus,
    brandExpectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
  })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .leftJoin(schema.warehouseInventory, eq(schema.warehouseInventory.id, schema.orderFulfillmentLines.warehouseInventoryId))
    .leftJoin(schema.brandOrderRequests, eq(schema.brandOrderRequests.fulfillmentLineId, schema.orderFulfillmentLines.id))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));

  // Nguồn "Khu chờ" (spec §5.3): đếm bulk kiện allocate_to_order + QC pass theo dòng.
  const stagedByLine = new Map<string, number>();
  if (lines.length > 0) {
    const staged = await db.select({
      lineId: schema.goodsReceiptItems.fulfillmentLineId,
      count: sql<number>`count(*)::int`,
    })
      .from(schema.goodsReceiptItems)
      .where(and(
        inArray(schema.goodsReceiptItems.fulfillmentLineId, lines.map((l) => l.id)),
        eq(schema.goodsReceiptItems.disposition, 'allocate_to_order'),
        eq(schema.goodsReceiptItems.qcResult, 'pass'),
      ))
      .groupBy(schema.goodsReceiptItems.fulfillmentLineId);
    for (const r of staged) if (r.lineId) stagedByLine.set(r.lineId, r.count);
  }

  // Địa chỉ giao + verify FedEx — để ops bắt địa chỉ sai/không giao được trước khi ship.
  const [ord] = await db.select({
    country: schema.shopifyOrders.shipCountry, city: schema.shopifyOrders.shipCity,
    line1: schema.shopifyOrders.shipAddress1, line2: schema.shopifyOrders.shipAddress2,
    province: schema.shopifyOrders.shipProvinceCode, name: schema.shopifyOrders.shipName,
    addrClass: schema.shopifyOrders.addrClass, addrDeliverable: schema.shopifyOrders.addrDeliverable,
    addrIssue: schema.shopifyOrders.addrIssue, addrStandardized: schema.shopifyOrders.addrStandardized,
    addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,
    addrConfidence: schema.shopifyOrders.addrConfidence,
  }).from(schema.shopifyOrders).where(eq(schema.shopifyOrders.id, ful.orderId)).limit(1);

  return {
    fulfillment: ful,
    address: ord ?? null,
    lines: lines.map((l) => ({ ...l, stagedCount: stagedByLine.get(l.id) ?? 0 })),
  };
}
