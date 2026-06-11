/** Read-side queries cho Khu chờ đi đơn (spec §2.3, §5.2).
 *  SQL mỏng — nhóm/tính sẵn sàng nằm trong staging-logic.ts (pure, có test). */
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { groupStaging, type StagingOrderGroup } from './staging-logic';

export type { StagingOrderGroup, StagingGroupLine, StagingGroupItem, LineSource } from './staging-logic';

/**
 * Khu chờ đi đơn, nhóm theo đơn (đơn cũ nhất trước). Kiện thuộc khu chờ khi:
 * disposition='allocate_to_order' + QC pass + gắn dòng đơn CHƯA shipped.
 * Hai truy vấn bulk (kiện + toàn bộ dòng của các đơn liên quan), không N+1.
 */
export async function listStaging(): Promise<StagingOrderGroup[]> {
  const items = await db.select({
    itemId: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    qcResult: schema.goodsReceiptItems.qcResult,
    receiptCode: schema.goodsReceipts.code,
    stagedAt: schema.goodsReceiptItems.createdAt,
    lineId: schema.orderFulfillmentLines.id,
    orderId: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    processedAt: schema.shopifyOrders.processedAtShopify,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts,
      eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .innerJoin(schema.orderFulfillmentLines,
      eq(schema.orderFulfillmentLines.id, schema.goodsReceiptItems.fulfillmentLineId))
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .innerJoin(schema.shopifyOrders,
      eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .where(and(
      eq(schema.goodsReceiptItems.disposition, 'allocate_to_order'),
      eq(schema.goodsReceiptItems.qcResult, 'pass'),
      isNotNull(schema.goodsReceiptItems.fulfillmentLineId),
      ne(schema.orderFulfillmentLines.status, 'shipped'),
    ));
  if (items.length === 0) return [];

  const orderIds = [...new Set(items.map((i) => i.orderId))];
  const lines = await db.select({
    orderId: schema.orderFulfillment.orderId,
    lineId: schema.orderFulfillmentLines.id,
    sku: schema.orderFulfillmentLines.sku,
    qty: schema.orderFulfillmentLines.qty,
    status: schema.orderFulfillmentLines.status,
    allocatedQty: schema.orderFulfillmentLines.allocatedQty,
    warehouseInventoryId: schema.orderFulfillmentLines.warehouseInventoryId,
    warehouseCode: schema.warehouseInventory.warehouseCode,
  })
    .from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment,
      eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .leftJoin(schema.warehouseInventory,
      eq(schema.warehouseInventory.id, schema.orderFulfillmentLines.warehouseInventoryId))
    .where(inArray(schema.orderFulfillment.orderId, orderIds));

  return groupStaging(items, lines);
}
