import { eq, desc } from 'drizzle-orm';
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
    shelf: schema.warehouseInventory.shelf,
    floor: schema.warehouseInventory.floor,
    bin: schema.warehouseInventory.bin,
  })
    .from(schema.orderFulfillmentLines)
    .leftJoin(schema.shopifyOrderLines, eq(schema.shopifyOrderLines.shopifyLineId, schema.orderFulfillmentLines.shopifyLineId))
    .leftJoin(schema.warehouseInventory, eq(schema.warehouseInventory.id, schema.orderFulfillmentLines.warehouseInventoryId))
    .where(eq(schema.orderFulfillmentLines.fulfillmentId, ful.id));
  return { fulfillment: ful, lines };
}

export async function listWarehouse() {
  return db.select().from(schema.warehouseInventory).orderBy(schema.warehouseInventory.sku);
}
