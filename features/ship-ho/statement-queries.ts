import { desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export async function listShipHoStatements() {
  return db
    .select({
      id: schema.shipHoStatements.id,
      partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      periodStart: schema.shipHoStatements.periodStart,
      periodEnd: schema.shipHoStatements.periodEnd,
      orderCount: schema.shipHoStatements.orderCount,
      totalChargedVnd: schema.shipHoStatements.totalChargedVnd,
      status: schema.shipHoStatements.status,
      issuedAt: schema.shipHoStatements.issuedAt,
      paidAt: schema.shipHoStatements.paidAt,
    })
    .from(schema.shipHoStatements)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoStatements.partnerBrandSlug))
    .orderBy(desc(schema.shipHoStatements.createdAt));
}

/** Công nợ = tổng totalChargedVnd của statement 'issued' (chưa 'paid') theo partner. */
export async function arByPartner() {
  return db
    .select({
      partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      outstandingVnd: sql<string>`sum(${schema.shipHoStatements.totalChargedVnd})`,
    })
    .from(schema.shipHoStatements)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoStatements.partnerBrandSlug))
    .where(eq(schema.shipHoStatements.status, 'issued'))
    .groupBy(schema.shipHoStatements.partnerBrandSlug, schema.mmpBrands.displayName);
}

/** Bảng kê + các đơn thuộc nó (kèm margin) — để xem chi tiết / export xlsx. */
export async function getShipHoStatement(id: string) {
  const [st] = await db.select().from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return null;
  const orders = await db
    .select({
      code: schema.shipHoOrders.code,
      country: schema.shipHoOrders.country,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
      marginVnd: schema.shipHoOrders.marginVnd,
    })
    .from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.statementId, id));
  return { statement: st, orders };
}

/** Báo cáo margin: tổng marginVnd theo partner (chỉ đơn đã đối soát). */
export async function marginByPartner() {
  return db
    .select({
      partnerBrandSlug: schema.shipHoOrders.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      orderCount: sql<number>`count(*)::int`,
      totalMarginVnd: sql<string>`coalesce(sum(${schema.shipHoOrders.marginVnd}), 0)`,
    })
    .from(schema.shipHoOrders)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoOrders.partnerBrandSlug))
    .where(sql`${schema.shipHoOrders.marginVnd} is not null`)
    .groupBy(schema.shipHoOrders.partnerBrandSlug, schema.mmpBrands.displayName);
}
