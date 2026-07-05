import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLifecycle } from '@/features/lifecycle/queries';

/** customer id nằm trong raw_payload->customer->id (Shopify webhook shape). */
const customerIdExpr = sql`${schema.shopifyOrders.rawPayload}->'customer'->>'id'`;

export async function listCustomerOrders(storeId: string, customerId: string) {
  return db.select({
    orderId: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    placedAt: schema.shopifyOrders.createdAtShopify,
    total: schema.shopifyOrders.totalPrice,
    currency: schema.shopifyOrders.currency,
    currentStage: schema.orderLifecycle.currentStage,
  })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderLifecycle, eq(schema.orderLifecycle.orderId, schema.shopifyOrders.id))
    .where(and(eq(schema.shopifyOrders.storeId, storeId), eq(customerIdExpr, customerId)))
    .orderBy(desc(schema.shopifyOrders.createdAtShopify));
}

/** Privacy gate: đơn phải thuộc đúng store + customer trước khi lộ dữ liệu. */
async function orderBelongsToCustomer(storeId: string, customerId: string, orderId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.shopifyOrders.id })
    .from(schema.shopifyOrders)
    .where(and(
      eq(schema.shopifyOrders.id, orderId),
      eq(schema.shopifyOrders.storeId, storeId),
      eq(customerIdExpr, customerId),
    ))
    .limit(1);
  return !!row;
}

export async function getCustomerOrderLifecycle(storeId: string, customerId: string, orderId: string) {
  if (!(await orderBelongsToCustomer(storeId, customerId, orderId))) return null;
  return getLifecycle(orderId);
}

export async function getCustomerLoyalty(storeId: string, customerId: string) {
  const [row] = await db.select({ tier: schema.customerLoyalty.tier, note: schema.customerLoyalty.note })
    .from(schema.customerLoyalty)
    .where(and(
      eq(schema.customerLoyalty.storeId, storeId),
      eq(schema.customerLoyalty.shopifyCustomerId, customerId),
    ))
    .limit(1);
  return row ?? null;
}
