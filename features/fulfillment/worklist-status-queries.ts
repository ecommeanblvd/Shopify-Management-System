import { desc, eq, sql, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface WorklistStatusRow {
  orderId: string; orderNumber: string | null; storeName: string | null;
  status: string; createdAtShopify: Date | null;
  addrDeliverable: boolean | null; addrVerifiedAt: Date | null;
  addrConfidence: string | null;
  kcs: { pending: number; pass: number; fail: number };
  ship: { packs: number; withTracking: number; delivered: number; exception: number; inTransit: number; tracks: Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }> };
  lark: { dispatchStatus: string | null; cxFfStatus: string | null; deliveryStatus: string | null; expectedDeliveryDate: string | null } | null;
  larkQc: string | null;
}

const n = (v: unknown) => Number(v ?? 0);

export async function listWorklistStatus(): Promise<WorklistStatusRow[]> {
  const base = await db.select({
    orderId: schema.orderFulfillment.orderId,
    status: schema.orderFulfillment.status,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
    createdAtShopify: schema.shopifyOrders.createdAtShopify,
    addrDeliverable: schema.shopifyOrders.addrDeliverable,
    addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,
    addrConfidence: schema.shopifyOrders.addrConfidence,
    larkDispatch: schema.larkOrderStatus.dispatchStatus,
    larkCxFf: schema.larkOrderStatus.cxFfStatus,
    larkDelivery: schema.larkOrderStatus.deliveryStatus,
    larkExpected: schema.larkOrderStatus.expectedDeliveryDate,
    larkQc: schema.larkOrderStatus.qcStatus,
  })
    .from(schema.orderFulfillment)
    .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderFulfillment.orderId))
    .innerJoin(schema.stores, eq(schema.stores.id, schema.shopifyOrders.storeId))
    .leftJoin(schema.larkOrderStatus, eq(schema.larkOrderStatus.orderId, schema.orderFulfillment.orderId))
    .orderBy(desc(schema.shopifyOrders.createdAtShopify));

  const kcsAgg = await db.select({
    orderId: schema.goodsReceiptItems.orderId,
    pending: sql<number>`count(*) filter (where ${schema.goodsReceiptItems.qcResult} = 'pending')`,
    pass: sql<number>`count(*) filter (where ${schema.goodsReceiptItems.qcResult} = 'pass')`,
    fail: sql<number>`count(*) filter (where ${schema.goodsReceiptItems.qcResult} = 'fail')`,
  }).from(schema.goodsReceiptItems).where(isNotNull(schema.goodsReceiptItems.orderId)).groupBy(schema.goodsReceiptItems.orderId);

  const shipAgg = await db.select({
    orderId: schema.shipments.orderId,
    packs: sql<number>`count(*)`,
    withTracking: sql<number>`count(*) filter (where ${schema.shipments.trackingNumber} is not null)`,
    delivered: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'delivered')`,
    exception: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'exception')`,
    inTransit: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} in ('in_transit','out_for_delivery'))`,
    tracks: sql<Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }>>`coalesce(json_agg(json_build_object('trackingNumber', ${schema.shipments.trackingNumber}, 'carrierKey', ${schema.shipments.carrierKey}, 'deliveryStatus', ${schema.shipments.deliveryStatus}, 'deliveredAt', ${schema.shipments.deliveredAt})) filter (where ${schema.shipments.trackingNumber} is not null), '[]')`,
  }).from(schema.shipments).groupBy(schema.shipments.orderId);

  const kMap = new Map(kcsAgg.map((r) => [r.orderId as string, r]));
  const sMap = new Map(shipAgg.map((r) => [r.orderId, r]));

  return base.map((r) => {
    const k = kMap.get(r.orderId); const s = sMap.get(r.orderId);
    const lark = (r.larkDispatch || r.larkCxFf || r.larkDelivery || r.larkExpected)
      ? { dispatchStatus: r.larkDispatch, cxFfStatus: r.larkCxFf, deliveryStatus: r.larkDelivery, expectedDeliveryDate: r.larkExpected }
      : null;
    return {
      orderId: r.orderId, status: r.status, orderNumber: r.orderNumber, storeName: r.storeName,
      createdAtShopify: r.createdAtShopify, addrDeliverable: r.addrDeliverable, addrVerifiedAt: r.addrVerifiedAt, addrConfidence: r.addrConfidence,
      kcs: { pending: n(k?.pending), pass: n(k?.pass), fail: n(k?.fail) },
      ship: { packs: n(s?.packs), withTracking: n(s?.withTracking), delivered: n(s?.delivered), exception: n(s?.exception), inTransit: n(s?.inTransit), tracks: s?.tracks ?? [] },
      lark,
      larkQc: r.larkQc,
    };
  });
}
