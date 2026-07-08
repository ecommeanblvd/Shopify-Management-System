import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface ShipHoOrderRow {
  id: string;
  code: string;
  partnerBrandSlug: string;
  brandName: string | null;
  country: string;
  weightKg: string;
  /** Cân tính cước = max(khai báo, dim weight); từ quote_breakdown. Null nếu chưa quote. */
  chargeableWeightKg: string | null;
  carrierKey: string | null;
  carrierCostVnd: string | null;
  actualCarrierCostVnd: string | null;
  chargedVnd: string | null;
  marginVnd: string | null;
  status: string;
  source: string;
  createdAt: Date;
  customerRef: string | null;
  trackingNumber: string | null;
  recipientName: string | null;
}

export async function listShipHoOrders(filter?: {
  partnerBrandSlug?: string;
  status?: string;
}): Promise<ShipHoOrderRow[]> {
  const conds = [];
  if (filter?.partnerBrandSlug) conds.push(eq(schema.shipHoOrders.partnerBrandSlug, filter.partnerBrandSlug));
  if (filter?.status) conds.push(eq(schema.shipHoOrders.status, filter.status as 'draft'));

  return db
    .select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      partnerBrandSlug: schema.shipHoOrders.partnerBrandSlug,
      brandName: schema.mmpBrands.displayName,
      country: schema.shipHoOrders.country,
      weightKg: schema.shipHoOrders.weightKg,
      chargeableWeightKg: sql<string | null>`${schema.shipHoOrders.quoteBreakdown}->>'chargeableWeightKg'`,
      carrierKey: schema.shipHoOrders.carrierKey,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      marginVnd: schema.shipHoOrders.marginVnd,
      status: schema.shipHoOrders.status,
      source: schema.shipHoOrders.source,
      createdAt: schema.shipHoOrders.createdAt,
      customerRef: schema.shipHoOrders.customerRef,
      trackingNumber: schema.shipHoOrders.trackingNumber,
      recipientName: schema.shipHoOrders.recipientName,
    })
    .from(schema.shipHoOrders)
    .leftJoin(schema.mmpBrands, eq(schema.mmpBrands.slug, schema.shipHoOrders.partnerBrandSlug))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.shipHoOrders.createdAt));
}

export async function getShipHoOrder(id: string) {
  const [row] = await db.select().from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, id)).limit(1);
  return row ?? null;
}
