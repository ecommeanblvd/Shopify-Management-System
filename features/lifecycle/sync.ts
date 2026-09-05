/**
 * Orchestrator vòng đời đơn: batch-load tín hiệu nguồn (pattern
 * worklist-status-queries), flatten → deriveLifecycle (thuần) → upsert
 * order_lifecycle. Chạy bởi cron sync-lifecycle; lần đầu = backfill tự nhiên.
 * Lỗi 1 đơn không abort batch.
 */
import { and, eq, gte, inArray, or, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { coThayDoi } from '@/lib/khong-doi';
import {
  deriveLifecycle, DEFAULT_SLA,
  type LifecyclePrev, type LifecycleSignals, type SlaKey,
} from './derive';

const TERMINAL = ['completed', 'refunded_full', 'cancelled'];

export async function loadSlaMap(): Promise<Record<SlaKey, number>> {
  const rows = await db.select().from(schema.lifecycleSla);
  const map = { ...DEFAULT_SLA };
  for (const r of rows) if (r.key in map) map[r.key as SlaKey] = r.targetHours;
  return map;
}

export async function syncOrderLifecycle(
  opts?: { sinceDays?: number },
): Promise<{ scanned: number; upserted: number; boQua: number; errors: string[] }> {
  const sinceDays = opts?.sinceDays ?? 120;
  const cutoff = new Date(Date.now() - sinceDays * 24 * 3600_000);
  const now = new Date();
  const sla = await loadSlaMap();
  const errors: string[] = [];

  // Đơn cần sync: tạo ≥ cutoff VÀ (chưa có snapshot HOẶC snapshot chưa terminal).
  const orders = await db.select({
    id: schema.shopifyOrders.id,
    storeId: schema.shopifyOrders.storeId,
    placedAt: schema.shopifyOrders.createdAtShopify,
    cancelledAt: schema.shopifyOrders.cancelledAtShopify,
    financialStatus: schema.shopifyOrders.financialStatus,
  })
    .from(schema.shopifyOrders)
    .leftJoin(schema.orderLifecycle, eq(schema.orderLifecycle.orderId, schema.shopifyOrders.id))
    .where(and(
      gte(schema.shopifyOrders.createdAtShopify, cutoff),
      or(
        isNull(schema.orderLifecycle.id),
        sql`${schema.orderLifecycle.currentStage} not in (${sql.join(TERMINAL.map((s) => sql`${s}`), sql`, `)})`,
      ),
    ));
  if (orders.length === 0) return { scanned: 0, upserted: 0, boQua: 0, errors };
  const orderIds = orders.map((o) => o.id);

  // --- Batch aggregations (GROUP BY orderId) ---
  const pushes = await db.select({
    orderId: schema.mmpOrderPushes.orderId,
    sentAt: schema.mmpOrderPushes.sentAt,
  })
    .from(schema.mmpOrderPushes)
    .where(and(eq(schema.mmpOrderPushes.status, 'sent'), inArray(schema.mmpOrderPushes.orderId, orderIds)));

  const brandAgg = await db.select({
    orderId: schema.brandOrderRequests.orderId,
    total: sql<number>`count(*)`,
    delivered: sql<number>`count(*) filter (where ${schema.brandOrderRequests.deliveredAt} is not null)`,
    deliveredMax: sql<string | null>`max(${schema.brandOrderRequests.deliveredAt})`,
    confirmedMax: sql<string | null>`max(${schema.brandOrderRequests.confirmedAt})`,
    etaMax: sql<string | null>`max(${schema.brandOrderRequests.expectedDeliveryDate})`,
  }).from(schema.brandOrderRequests)
    .where(inArray(schema.brandOrderRequests.orderId, orderIds))
    .groupBy(schema.brandOrderRequests.orderId);

  const packAgg = await db.select({
    orderId: schema.orderFulfillment.orderId,
    packedMin: sql<string | null>`min(${schema.orderFulfillmentLines.packedAt})`,
  }).from(schema.orderFulfillmentLines)
    .innerJoin(schema.orderFulfillment, eq(schema.orderFulfillment.id, schema.orderFulfillmentLines.fulfillmentId))
    .where(inArray(schema.orderFulfillment.orderId, orderIds))
    .groupBy(schema.orderFulfillment.orderId);

  const shipAgg = await db.select({
    orderId: schema.shipments.orderId,
    packs: sql<number>`count(*)`,
    delivered: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'delivered')`,
    exception: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'exception')`,
    inTransit: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} in ('in_transit','out_for_delivery'))`,
    outForDelivery: sql<number>`count(*) filter (where ${schema.shipments.deliveryStatus} = 'out_for_delivery')`,
    withTracking: sql<number>`count(*) filter (where ${schema.shipments.trackingNumber} is not null)`,
    labelMin: sql<string | null>`min(${schema.shipments.labelCreatedAt})`,
    deliveredMax: sql<string | null>`max(${schema.shipments.deliveredAt})`,
    packedFallbackMin: sql<string | null>`min(${schema.shipments.createdAt})`,
  }).from(schema.shipments)
    .where(inArray(schema.shipments.orderId, orderIds))
    .groupBy(schema.shipments.orderId);

  const refundAgg = await db.select({
    orderId: schema.shopifyOrderRefunds.orderId,
    firstAt: sql<string | null>`min(${schema.shopifyOrderRefunds.refundedAt})`,
  }).from(schema.shopifyOrderRefunds)
    .where(inArray(schema.shopifyOrderRefunds.orderId, orderIds))
    .groupBy(schema.shopifyOrderRefunds.orderId);

  const lark = await db.select({
    orderId: schema.larkOrderStatus.orderId,
    qc: schema.larkOrderStatus.qcStatus,
    dispatch: schema.larkOrderStatus.dispatchStatus,
    eta: schema.larkOrderStatus.expectedDeliveryDate,
  }).from(schema.larkOrderStatus).where(inArray(schema.larkOrderStatus.orderId, orderIds));

  const prevRows = await db.select().from(schema.orderLifecycle)
    .where(inArray(schema.orderLifecycle.orderId, orderIds));

  const ts = (v: string | Date | null | undefined): Date | null =>
    v == null ? null : v instanceof Date ? v : new Date(v);
  const pushMap = new Map(pushes.map((r) => [r.orderId, r.sentAt]));
  const brandMap = new Map(brandAgg.map((r) => [r.orderId, r]));
  const packMap = new Map(packAgg.map((r) => [r.orderId, r]));
  const shipMap = new Map(shipAgg.map((r) => [r.orderId, r]));
  const refundMap = new Map(refundAgg.map((r) => [r.orderId, r.firstAt]));
  const larkMap = new Map(lark.map((r) => [r.orderId, r]));
  const prevMap = new Map(prevRows.map((r) => [r.orderId, r]));

  let upserted = 0;
  let boQua = 0;
  for (const o of orders) {
    try {
      const b = brandMap.get(o.id);
      const s = shipMap.get(o.id);
      const lk = larkMap.get(o.id);
      const n = (v: unknown) => Number(v ?? 0);

      const signals: LifecycleSignals = {
        placedAt: o.placedAt,
        cancelledAt: o.cancelledAt,
        financialStatus: o.financialStatus,
        mmpSentAt: pushMap.get(o.id) ?? null,
        brandConfirmedAt: ts(b?.confirmedMax),
        brandEta: b?.etaMax ?? lk?.eta ?? null,
        brandRequestCount: n(b?.total),
        brandDeliveredCount: n(b?.delivered),
        brandDeliveredMaxAt: ts(b?.deliveredMax),
        larkQc: lk?.qc ?? null,
        larkDispatch: lk?.dispatch ?? null,
        packedMinAt: ts(packMap.get(o.id)?.packedMin) ?? ts(s?.packedFallbackMin),
        labelMinAt: ts(s?.labelMin),
        hasTracking: n(s?.withTracking) > 0,
        packs: n(s?.packs),
        packsDelivered: n(s?.delivered),
        packsException: n(s?.exception),
        anyInTransit: n(s?.inTransit) > 0,
        anyOutForDelivery: n(s?.outForDelivery) > 0,
        shipDeliveredMaxAt: ts(s?.deliveredMax),
        refundFirstAt: ts(refundMap.get(o.id)),
      };
      const p = prevMap.get(o.id);
      const prev: LifecyclePrev | null = p ? {
        qcPassAt: p.qcPassAt,
        inTransitAt: p.inTransitAt,
        outForDeliveryAt: p.outForDeliveryAt,
        returnProcessingAt: p.returnProcessingAt,
        shippedAt: p.shippedAt,
        deliveredAt: p.deliveredAt,
        completedAt: p.completedAt,
      } : null;

      const snap = deriveLifecycle(signals, prev, sla, now);
      // Bỏ qua đơn không đổi gì: trước 05/09 vòng lặp upsert MỌI đơn mỗi lượt
      // (~2.577 lệnh) dù snapshot y hệt. `p` đã nạp đủ cột nên so được ngay,
      // không tốn thêm truy vấn nào. Cùng cách đã đưa sync-lark 68,7 → 1,7 phút.
      if (!coThayDoi(p as unknown as Record<string, unknown> | undefined, snap as unknown as Record<string, unknown>)) {
        boQua += 1;
        continue;
      }
      await db.insert(schema.orderLifecycle)
        .values({ orderId: o.id, storeId: o.storeId, ...snap, syncedAt: now })
        .onConflictDoUpdate({
          target: schema.orderLifecycle.orderId,
          set: { ...snap, syncedAt: now },
        });
      upserted += 1;
    } catch (e) {
      errors.push(`${o.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { scanned: orders.length, upserted, boQua, errors };
}
