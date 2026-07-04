import { and, eq, gte, lte, isNotNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { computeDurations, type DurationRow } from './stats-logic';

export interface StatsFilter {
  storeId?: string;
  brand?: string;
  carrier?: string;
  fromMonth?: string; // 'YYYY-MM'
  toMonth?: string;   // 'YYYY-MM'
}

const monthExpr = sql<string>`to_char(${schema.orderLifecycle.placedAt}, 'YYYY-MM')`;

export async function lifecycleDurations(filter?: StatsFilter): Promise<DurationRow[]> {
  const conds = [];
  if (filter?.storeId) conds.push(eq(schema.orderLifecycle.storeId, filter.storeId));
  if (filter?.fromMonth) conds.push(gte(monthExpr, filter.fromMonth));
  if (filter?.toMonth) conds.push(lte(monthExpr, filter.toMonth));

  const base = await db.select({
    orderId: schema.orderLifecycle.orderId,
    storeId: schema.orderLifecycle.storeId,
    storeName: schema.stores.name,
    placedMonth: monthExpr,
    placedAt: schema.orderLifecycle.placedAt,
    productionStartAt: schema.orderLifecycle.productionStartAt,
    goodsReceivedAt: schema.orderLifecycle.goodsReceivedAt,
    qcPassAt: schema.orderLifecycle.qcPassAt,
    packedAt: schema.orderLifecycle.packedAt,
    shippedAt: schema.orderLifecycle.shippedAt,
    deliveredAt: schema.orderLifecycle.deliveredAt,
    delayStatus: schema.orderLifecycle.delayStatus,
  })
    .from(schema.orderLifecycle)
    .leftJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .where(conds.length ? and(...conds) : undefined);

  // brands theo đơn (vendor distinct)
  const brandRows = await db.select({
    orderId: schema.shopifyOrderLines.orderId,
    brands: sql<string[]>`array_agg(distinct ${schema.shopifyOrderLines.vendor})`,
  })
    .from(schema.shopifyOrderLines)
    .where(isNotNull(schema.shopifyOrderLines.vendor))
    .groupBy(schema.shopifyOrderLines.orderId);
  const brandMap = new Map(brandRows.map((r) => [r.orderId, (r.brands ?? []).filter(Boolean)]));

  // carriers theo đơn (carrierKey distinct)
  const carrierRows = await db.select({
    orderId: schema.shipments.orderId,
    carriers: sql<string[]>`array_agg(distinct ${schema.shipments.carrierKey})`,
  })
    .from(schema.shipments)
    .where(isNotNull(schema.shipments.carrierKey))
    .groupBy(schema.shipments.orderId);
  const carrierMap = new Map(carrierRows.map((r) => [r.orderId, (r.carriers ?? []).filter(Boolean)]));

  const rows: DurationRow[] = base.map((b) => ({
    orderId: b.orderId,
    storeId: b.storeId,
    storeName: b.storeName ?? null,
    placedMonth: b.placedMonth,
    brands: brandMap.get(b.orderId) ?? [],
    carriers: carrierMap.get(b.orderId) ?? [],
    stale: b.delayStatus === 'stale',
    dur: computeDurations(b),
  }));

  return rows.filter((r) => {
    if (filter?.brand && !r.brands.includes(filter.brand)) return false;
    if (filter?.carrier && !r.carriers.includes(filter.carrier)) return false;
    return true;
  });
}

export async function listLifecycleStores(): Promise<Array<{ id: string; name: string | null }>> {
  const rows = await db.selectDistinct({
    id: schema.stores.id,
    name: schema.stores.name,
  })
    .from(schema.orderLifecycle)
    .innerJoin(schema.stores, eq(schema.stores.id, schema.orderLifecycle.storeId))
    .orderBy(schema.stores.name);
  return rows;
}

export async function listBrandOptions(): Promise<string[]> {
  const rows = await db.selectDistinct({ vendor: schema.shopifyOrderLines.vendor })
    .from(schema.shopifyOrderLines)
    .where(isNotNull(schema.shopifyOrderLines.vendor))
    .orderBy(schema.shopifyOrderLines.vendor);
  return rows.map((r) => r.vendor!).filter(Boolean);
}

export async function listCarrierOptions(): Promise<string[]> {
  const rows = await db.selectDistinct({ carrierKey: schema.shipments.carrierKey })
    .from(schema.shipments)
    .where(isNotNull(schema.shipments.carrierKey))
    .orderBy(schema.shipments.carrierKey);
  return rows.map((r) => r.carrierKey!).filter(Boolean);
}
