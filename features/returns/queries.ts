import { eq, desc, and, ne, ilike, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { refundReconcileFlag, type RefundReconcileFlag } from './logic';

export interface ReturnListRow {
  id: string;
  code: string;
  status: string;
  orderId: string;
  orderNumber: string;
  receivedAt: Date;
  totalPassQty: number;
  refundCount: number;
  refundTotal: string;
  refundFlag: RefundReconcileFlag;
}

/** Returns newest first, with order number, restocked total, and refund badge. */
export async function listReturns(): Promise<ReturnListRow[]> {
  const rows = await db.select({
    id: schema.customerReturns.id,
    code: schema.customerReturns.code,
    status: schema.customerReturns.status,
    orderId: schema.customerReturns.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    receivedAt: schema.customerReturns.receivedAt,
  })
    .from(schema.customerReturns)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.customerReturns.orderId))
    .orderBy(desc(schema.customerReturns.createdAt));

  if (rows.length === 0) return [];
  const returnIds = rows.map((r) => r.id);
  const orderIds = [...new Set(rows.map((r) => r.orderId))];

  const lines = await db.select({
    returnId: schema.customerReturnLines.returnId,
    passQty: schema.customerReturnLines.passQty,
  }).from(schema.customerReturnLines).where(inArray(schema.customerReturnLines.returnId, returnIds));

  const refunds = await db.select({
    orderId: schema.shopifyOrderRefunds.orderId,
    amount: schema.shopifyOrderRefunds.amount,
  }).from(schema.shopifyOrderRefunds).where(inArray(schema.shopifyOrderRefunds.orderId, orderIds));

  return rows.map((r) => {
    const totalPassQty = lines.filter((l) => l.returnId === r.id).reduce((s, l) => s + l.passQty, 0);
    const orderRefunds = refunds.filter((x) => x.orderId === r.orderId);
    const refundCount = orderRefunds.length;
    const refundTotal = orderRefunds.reduce((s, x) => s + Number(x.amount), 0).toFixed(2);
    return {
      id: r.id,
      code: r.code,
      status: r.status,
      orderId: r.orderId,
      orderNumber: r.orderNumber,
      receivedAt: r.receivedAt as Date,
      totalPassQty,
      refundCount,
      refundTotal,
      refundFlag: refundReconcileFlag({ totalPassQty, shopifyRefundCount: refundCount }),
    };
  });
}

/** Full return detail: header, lines, and the order's Shopify refunds. */
export async function getReturnWithLines(id: string) {
  const [ret] = await db.select({
    id: schema.customerReturns.id,
    code: schema.customerReturns.code,
    status: schema.customerReturns.status,
    orderId: schema.customerReturns.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    warehouseCode: schema.customerReturns.warehouseCode,
    receivedAt: schema.customerReturns.receivedAt,
    qcDoneAt: schema.customerReturns.qcDoneAt,
    note: schema.customerReturns.note,
  })
    .from(schema.customerReturns)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.customerReturns.orderId))
    .where(eq(schema.customerReturns.id, id))
    .limit(1);
  if (!ret) return null;

  const lines = await db.select()
    .from(schema.customerReturnLines)
    .where(eq(schema.customerReturnLines.returnId, id))
    .orderBy(schema.customerReturnLines.createdAt);

  const refunds = await db.select({
    amount: schema.shopifyOrderRefunds.amount,
    refundedAt: schema.shopifyOrderRefunds.refundedAt,
    reason: schema.shopifyOrderRefunds.reason,
  }).from(schema.shopifyOrderRefunds).where(eq(schema.shopifyOrderRefunds.orderId, ret.orderId));

  const totalPassQty = lines.reduce((s, l) => s + l.passQty, 0);
  return {
    ...ret,
    lines,
    refunds,
    refundFlag: refundReconcileFlag({ totalPassQty, shopifyRefundCount: refunds.length }),
  };
}

export interface OrderSearchRow {
  id: string;
  orderNumber: string;
  financialStatus: string;
  processedAt: Date;
}

/** Order picker for creating a return — match by order number. */
export async function searchOrdersForReturn(q: string): Promise<OrderSearchRow[]> {
  const term = `%${q.trim()}%`;
  const rows = await db.select({
    id: schema.shopifyOrders.id,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    financialStatus: schema.shopifyOrders.financialStatus,
    processedAt: schema.shopifyOrders.processedAtShopify,
  })
    .from(schema.shopifyOrders)
    .where(ilike(schema.shopifyOrders.shopifyOrderNumber, term))
    .orderBy(desc(schema.shopifyOrders.processedAtShopify))
    .limit(20);
  return rows.map((r) => ({ ...r, processedAt: r.processedAt as Date }));
}

export interface OrderLineForReturn {
  shopifyLineId: string;
  sku: string | null;
  productTitle: string;
  variantTitle: string | null;
  quantity: number;
  alreadyReturned: number;
  returnableQty: number;
}

/** Order lines + how many units are already on non-cancelled returns (over-return guard). */
export async function getOrderLinesForReturn(orderId: string): Promise<OrderLineForReturn[]> {
  const lines = await db.select({
    shopifyLineId: schema.shopifyOrderLines.shopifyLineId,
    sku: schema.shopifyOrderLines.sku,
    productTitle: schema.shopifyOrderLines.productTitle,
    variantTitle: schema.shopifyOrderLines.variantTitle,
    quantity: schema.shopifyOrderLines.quantity,
  }).from(schema.shopifyOrderLines).where(eq(schema.shopifyOrderLines.orderId, orderId));

  const prior = await db.select({
    shopifyLineId: schema.customerReturnLines.shopifyLineId,
    returnedQty: schema.customerReturnLines.returnedQty,
  })
    .from(schema.customerReturnLines)
    .innerJoin(schema.customerReturns, eq(schema.customerReturns.id, schema.customerReturnLines.returnId))
    .where(and(eq(schema.customerReturns.orderId, orderId), ne(schema.customerReturns.status, 'cancelled')));

  return lines.map((l) => {
    const already = prior
      .filter((p) => p.shopifyLineId === l.shopifyLineId)
      .reduce((s, p) => s + p.returnedQty, 0);
    return { ...l, alreadyReturned: already, returnableQty: l.quantity - already };
  });
}
