/** Domain logic Order Journey (db): journey + tạo request + tracking.
 *  Server LUÔN re-check policy — không tin client. Tiền snapshot tại đây. */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { evaluateOrderPolicy, type PolicyResult } from './order-policy';
import { CLAIM_REASONS, OPEN_STATUSES, canTransition, type RequestStatus } from './request-status';

const customerIdExpr = sql`${schema.shopifyOrders.rawPayload}->'customer'->>'id'`;

async function loadOrderForCustomer(storeId: string, customerId: string, orderId: string) {
  const [row] = await db.select({
    id: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    totalPrice: schema.shopifyOrders.totalPrice,
    currency: schema.shopifyOrders.currency,
    lc: schema.orderLifecycle,
  })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderLifecycle, eq(schema.orderLifecycle.orderId, schema.shopifyOrders.id))
    .where(and(
      eq(schema.shopifyOrders.id, orderId),
      eq(schema.shopifyOrders.storeId, storeId),
      eq(customerIdExpr, customerId),
    ))
    .limit(1);
  return row ?? null;
}

export async function listOrderRequests(storeId: string, orderId: string) {
  return db.select().from(schema.customerOrderRequests)
    .where(and(eq(schema.customerOrderRequests.storeId, storeId), eq(schema.customerOrderRequests.orderId, orderId)))
    .orderBy(desc(schema.customerOrderRequests.createdAt));
}

async function hasOpenRequest(storeId: string, orderId: string): Promise<boolean> {
  const [row] = await db.select({ id: schema.customerOrderRequests.id })
    .from(schema.customerOrderRequests)
    .where(and(
      eq(schema.customerOrderRequests.storeId, storeId),
      eq(schema.customerOrderRequests.orderId, orderId),
      inArray(schema.customerOrderRequests.status, OPEN_STATUSES),
    )).limit(1);
  return !!row;
}

export async function getOrderJourney(storeId: string, customerId: string, orderId: string) {
  const order = await loadOrderForCustomer(storeId, customerId, orderId);
  if (!order) return null;
  const open = await hasOpenRequest(storeId, orderId);
  const policy = evaluateOrderPolicy({
    placedAt: order.lc?.placedAt ?? null,
    productionConfirmedAt: order.lc?.productionConfirmedAt ?? null,
    shippedAt: order.lc?.shippedAt ?? null,
    deliveredAt: order.lc?.deliveredAt ?? null,
    cancelledAt: order.lc?.cancelledAt ?? null,
    orderTotal: order.totalPrice,
    currency: order.currency,
    hasOpenRequest: open,
    now: new Date(),
  });
  const requests = await listOrderRequests(storeId, orderId);
  return { order, policy, requests };
}

type CreateInput =
  | { kind: 'cancel' }
  | { kind: 'claim'; reasonCodes: string[]; description: string; photoKeys: string[] };

export async function createOrderRequest(
  storeId: string, customerId: string, orderId: string, input: CreateInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const journey = await getOrderJourney(storeId, customerId, orderId);
  if (!journey) return { ok: false, error: 'order not found' };
  const { order, policy } = journey;

  if (input.kind === 'cancel') {
    if (!policy.canCancel) return { ok: false, error: 'cancellation not available' };
    const [row] = await db.insert(schema.customerOrderRequests).values({
      storeId, orderId, shopifyCustomerId: customerId, orderNumber: order.orderNumber,
      kind: 'cancel',
      status: 'refund_pending' satisfies RequestStatus,   // policy engine tự duyệt — vào thẳng queue refund
      orderTotal: order.totalPrice,
      refundPercent: policy.refundPercent,
      refundAmount: policy.refundAmount,
      currency: order.currency,
    }).returning({ id: schema.customerOrderRequests.id });
    return { ok: true, id: row.id };
  }

  // claim
  if (!policy.canClaim) return { ok: false, error: 'claim window closed' };
  const reasons = input.reasonCodes.filter((r): r is (typeof CLAIM_REASONS)[number] =>
    (CLAIM_REASONS as readonly string[]).includes(r));
  if (reasons.length === 0) return { ok: false, error: 'select at least one issue' };
  if (input.photoKeys.length < 1 || input.photoKeys.length > 5) return { ok: false, error: 'photos: 1-5 required' };
  const [row] = await db.insert(schema.customerOrderRequests).values({
    storeId, orderId, shopifyCustomerId: customerId, orderNumber: order.orderNumber,
    kind: 'claim', status: 'submitted' satisfies RequestStatus,
    reasonCodes: reasons, description: input.description.trim() || null,
    photoKeys: input.photoKeys,
    orderTotal: order.totalPrice, refundPercent: 100, refundAmount: order.totalPrice, currency: order.currency,
  }).returning({ id: schema.customerOrderRequests.id });
  return { ok: true, id: row.id };
}

export async function addReturnTracking(
  storeId: string, customerId: string, requestId: string, carrier: string, tracking: string,
): Promise<{ ok: boolean; error?: string }> {
  const [req] = await db.select().from(schema.customerOrderRequests)
    .where(and(
      eq(schema.customerOrderRequests.id, requestId),
      eq(schema.customerOrderRequests.storeId, storeId),
      eq(schema.customerOrderRequests.shopifyCustomerId, customerId),
    )).limit(1);
  if (!req) return { ok: false, error: 'not found' };
  if (!canTransition('claim', req.status as RequestStatus, 'return_in_transit')) {
    return { ok: false, error: 'tracking not expected at this stage' };
  }
  const cleanCarrier = carrier.trim(), cleanTracking = tracking.trim();
  if (!cleanCarrier || !cleanTracking) return { ok: false, error: 'carrier and tracking required' };
  await db.update(schema.customerOrderRequests).set({
    returnCarrier: cleanCarrier, returnTrackingNumber: cleanTracking,
    status: 'return_in_transit', trackingAddedAt: new Date(), updatedAt: new Date(),
  }).where(eq(schema.customerOrderRequests.id, requestId));
  return { ok: true };
}
