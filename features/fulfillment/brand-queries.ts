import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listBrandRequests() {
  return db.select({
    id: schema.brandOrderRequests.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    brandSlug: schema.brandOrderRequests.brandSlug,
    sku: schema.brandOrderRequests.sku,
    qty: schema.brandOrderRequests.qty,
    sendStatus: schema.brandOrderRequests.sendStatus,
    confirmStatus: schema.brandOrderRequests.confirmStatus,
    expectedDeliveryDate: schema.brandOrderRequests.expectedDeliveryDate,
    lastError: schema.brandOrderRequests.lastError,
    createdAt: schema.brandOrderRequests.createdAt,
  })
    .from(schema.brandOrderRequests)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
    .orderBy(desc(schema.brandOrderRequests.createdAt));
}

export async function listBrandRequestsForOrder(orderId: string) {
  return db.select().from(schema.brandOrderRequests)
    .where(eq(schema.brandOrderRequests.orderId, orderId));
}
