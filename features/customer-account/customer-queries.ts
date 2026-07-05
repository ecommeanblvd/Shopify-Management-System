import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getLifecycle } from '@/features/lifecycle/queries';
import { canCreateReturn } from './return-logic';

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

export async function listCustomerReturns(storeId: string, customerId: string) {
  return db.select({
    id: schema.customerReturnRequests.id,
    orderId: schema.customerReturnRequests.orderId,
    orderNumber: schema.customerReturnRequests.orderNumber,
    reason: schema.customerReturnRequests.reason,
    status: schema.customerReturnRequests.status,
    createdAt: schema.customerReturnRequests.createdAt,
  })
    .from(schema.customerReturnRequests)
    .where(and(
      eq(schema.customerReturnRequests.storeId, storeId),
      eq(schema.customerReturnRequests.shopifyCustomerId, customerId),
    ))
    .orderBy(desc(schema.customerReturnRequests.createdAt));
}

export async function createCustomerReturn(
  storeId: string,
  customerId: string,
  orderId: string,
  reason: string,
  note: string | null,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!reason?.trim()) return { ok: false, error: 'reason required' };
  if (!(await orderBelongsToCustomer(storeId, customerId, orderId))) return { ok: false, error: 'order not found' };

  const existing = await db.select({
    orderId: schema.customerReturnRequests.orderId,
    status: schema.customerReturnRequests.status,
  })
    .from(schema.customerReturnRequests)
    .where(and(
      eq(schema.customerReturnRequests.storeId, storeId),
      eq(schema.customerReturnRequests.shopifyCustomerId, customerId),
    ));

  const guard = canCreateReturn(existing, orderId);
  if (!guard.ok) return { ok: false, error: 'Đã có yêu cầu đang xử lý cho đơn này' };

  const [order] = await db.select({ n: schema.shopifyOrders.shopifyOrderNumber })
    .from(schema.shopifyOrders)
    .where(eq(schema.shopifyOrders.id, orderId))
    .limit(1);

  const [row] = await db.insert(schema.customerReturnRequests)
    .values({
      storeId,
      orderId,
      shopifyCustomerId: customerId,
      orderNumber: order?.n ?? null,
      reason: reason.trim(),
      note: note?.trim() || null,
    })
    .returning({ id: schema.customerReturnRequests.id });

  return { ok: true, id: row.id };
}
