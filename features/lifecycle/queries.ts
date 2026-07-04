import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { stageAnchorAt, hoursBetween } from './display';

export interface LifecycleListRow {
  orderId: string;
  orderNumber: string | null;
  storeName: string | null;
  currentStage: string;
  exception: boolean;
  delayStatus: string;
  delayHours: number;
  deadline: Date | null;
  timeInStageHrs: number | null;
}

export async function listLifecycle(
  filter?: { stage?: string; delay?: string; storeId?: string },
): Promise<LifecycleListRow[]> {
  const conds = [];
  if (filter?.stage) conds.push(eq(schema.orderLifecycle.currentStage, filter.stage));
  if (filter?.delay) conds.push(eq(schema.orderLifecycle.delayStatus, filter.delay));
  if (filter?.storeId) conds.push(eq(schema.orderLifecycle.storeId, filter.storeId));

  const rows = await db.select({
    orderId: schema.orderLifecycle.orderId,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
    currentStage: schema.orderLifecycle.currentStage,
    exception: schema.orderLifecycle.exception,
    delayStatus: schema.orderLifecycle.delayStatus,
    delayHours: schema.orderLifecycle.delayHours,
    deadline: schema.orderLifecycle.deadline,
    placedAt: schema.orderLifecycle.placedAt,
    productionStartAt: schema.orderLifecycle.productionStartAt,
    goodsReceivedAt: schema.orderLifecycle.goodsReceivedAt,
    qcPassAt: schema.orderLifecycle.qcPassAt,
    packedAt: schema.orderLifecycle.packedAt,
    shippedAt: schema.orderLifecycle.shippedAt,
    inTransitAt: schema.orderLifecycle.inTransitAt,
    outForDeliveryAt: schema.orderLifecycle.outForDeliveryAt,
    deliveredAt: schema.orderLifecycle.deliveredAt,
    completedAt: schema.orderLifecycle.completedAt,
  })
    .from(schema.orderLifecycle)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderLifecycle.orderId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.orderLifecycle.delayHours), desc(schema.orderLifecycle.deadline));

  const now = new Date();
  return rows.map((r) => ({
    orderId: r.orderId, orderNumber: r.orderNumber, storeName: r.storeName,
    currentStage: r.currentStage, exception: r.exception,
    delayStatus: r.delayStatus, delayHours: r.delayHours, deadline: r.deadline,
    timeInStageHrs: hoursBetween(stageAnchorAt(r.currentStage, r), now),
  }));
}

export async function stageCounts(): Promise<Record<string, number>> {
  const rows = await db.select({
    stage: schema.orderLifecycle.currentStage,
    n: sql<number>`count(*)::int`,
  }).from(schema.orderLifecycle).groupBy(schema.orderLifecycle.currentStage);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.stage] = r.n;
  return out;
}

export async function getLifecycle(orderId: string) {
  const [row] = await db.select({
    lc: schema.orderLifecycle,
    orderNumber: schema.shopifyOrders.shopifyOrderNumber,
    storeName: schema.stores.name,
  })
    .from(schema.orderLifecycle)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.orderLifecycle.orderId))
    .leftJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .where(eq(schema.orderLifecycle.orderId, orderId))
    .limit(1);
  if (!row) return null;
  return { ...row.lc, orderNumber: row.orderNumber, storeName: row.storeName };
}

export async function listSla(): Promise<Array<{ key: string; targetHours: number; note: string | null }>> {
  return db.select({
    key: schema.lifecycleSla.key,
    targetHours: schema.lifecycleSla.targetHours,
    note: schema.lifecycleSla.note,
  }).from(schema.lifecycleSla).orderBy(schema.lifecycleSla.key);
}
