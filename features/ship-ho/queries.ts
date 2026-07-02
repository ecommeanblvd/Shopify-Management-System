import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface ShipHoOrderRow {
  id: string;
  code: string;
  partnerBrandSlug: string;
  brandName: string | null;
  country: string;
  weightKg: string;
  carrierKey: string | null;
  carrierCostVnd: string | null;
  chargedVnd: string | null;
  status: string;
  createdAt: Date;
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
      carrierKey: schema.shipHoOrders.carrierKey,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      status: schema.shipHoOrders.status,
      createdAt: schema.shipHoOrders.createdAt,
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
