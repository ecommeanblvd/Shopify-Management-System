import { desc, eq, sql, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { deriveOrderStage, type OrderStage } from './order-stage';

export interface WorklistStatusRow {
  orderId: string; orderNumber: string | null; storeName: string | null;
  status: string; createdAtShopify: Date | null;
  /** Stage vòng đời suy ra từ tín hiệu thật (cột Tình trạng). */
  stage: OrderStage;
  /** Phát hiện sửa (sub-project C): last-updated + cờ sửa / sửa-sau-ship. */
  updatedAtShopify: Date | null; editedAt: Date | null; editedAfterFulfilledAt: Date | null;
  addrDeliverable: boolean | null; addrVerifiedAt: Date | null;
  addrConfidence: string | null;
  /** Carrier logistic staff đã chọn để đi hàng (selected_carrier_key). */
  selectedCarrierKey: string | null;
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
    updatedAtShopify: schema.shopifyOrders.updatedAtShopify,
    editedAt: schema.shopifyOrders.editedAt,
    editedAfterFulfilledAt: schema.shopifyOrders.editedAfterFulfilledAt,
    addrDeliverable: schema.shopifyOrders.addrDeliverable,
    addrVerifiedAt: schema.shopifyOrders.addrVerifiedAt,
    addrConfidence: schema.shopifyOrders.addrConfidence,
    selectedCarrierKey: schema.shopifyOrders.selectedCarrierKey,
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
    outForDelivery: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'out_for_delivery')`,
    tracks: sql<Array<{ trackingNumber: string; carrierKey: string | null; deliveryStatus: string | null; deliveredAt: string | null }>>`coalesce(json_agg(json_build_object('trackingNumber', ${schema.shipments.trackingNumber}, 'carrierKey', ${schema.shipments.carrierKey}, 'deliveryStatus', ${schema.shipments.deliveryStatus}, 'deliveredAt', ${schema.shipments.deliveredAt})) filter (where ${schema.shipments.trackingNumber} is not null), '[]')`,
  }).from(schema.shipments).groupBy(schema.shipments.orderId);

  // Đã báo brand: đơn đã đẩy MMP thành công.
  const pushed = await db.select({ orderId: schema.mmpOrderPushes.orderId })
    .from(schema.mmpOrderPushes).where(eq(schema.mmpOrderPushes.status, 'sent'));

  // Nhánh kho: mọi SKU của đơn còn tồn > 0 (pre-agg tồn theo sku).
  const stockAgg = await db.select({
    orderId: schema.shopifyOrderLines.orderId,
    allInStock: sql<boolean>`bool_and(coalesce(wi.q, 0) > 0)`,
  })
    .from(schema.shopifyOrderLines)
    .leftJoin(
      sql`(select ${schema.warehouseInventory.sku} as sku, sum(${schema.warehouseInventory.qtyOnHand}) as q from ${schema.warehouseInventory} group by ${schema.warehouseInventory.sku}) wi`,
      sql`wi.sku = ${schema.shopifyOrderLines.sku}`,
    )
    .groupBy(schema.shopifyOrderLines.orderId);

  const kMap = new Map(kcsAgg.map((r) => [r.orderId as string, r]));
  const sMap = new Map(shipAgg.map((r) => [r.orderId, r]));
  const pushedSet = new Set(pushed.map((r) => r.orderId));
  const stockMap = new Map(stockAgg.map((r) => [r.orderId, r.allInStock]));

  return base.map((r) => {
    const k = kMap.get(r.orderId); const s = sMap.get(r.orderId);
    const lark = (r.larkDispatch || r.larkCxFf || r.larkDelivery || r.larkExpected)
      ? { dispatchStatus: r.larkDispatch, cxFfStatus: r.larkCxFf, deliveryStatus: r.larkDelivery, expectedDeliveryDate: r.larkExpected }
      : null;
    const ship = { packs: n(s?.packs), withTracking: n(s?.withTracking), delivered: n(s?.delivered), exception: n(s?.exception), inTransit: n(s?.inTransit), outForDelivery: n((s as { outForDelivery?: number } | undefined)?.outForDelivery) };
    const stage = deriveOrderStage({
      pushedMmp: pushedSet.has(r.orderId),
      larkQc: r.larkQc,
      larkDispatch: r.larkDispatch,
      ship,
      allInStock: stockMap.get(r.orderId) === true,
    });
    return {
      orderId: r.orderId, status: r.status, stage, orderNumber: r.orderNumber, storeName: r.storeName,
      createdAtShopify: r.createdAtShopify,
      updatedAtShopify: r.updatedAtShopify, editedAt: r.editedAt, editedAfterFulfilledAt: r.editedAfterFulfilledAt,
      addrDeliverable: r.addrDeliverable, addrVerifiedAt: r.addrVerifiedAt, addrConfidence: r.addrConfidence,
      selectedCarrierKey: r.selectedCarrierKey,
      kcs: { pending: n(k?.pending), pass: n(k?.pass), fail: n(k?.fail) },
      ship: { packs: ship.packs, withTracking: ship.withTracking, delivered: ship.delivered, exception: ship.exception, inTransit: ship.inTransit, tracks: s?.tracks ?? [] },
      lark,
      larkQc: r.larkQc,
    };
  });
}
