'use server';

import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';

export interface PeriodSystemTotal {
  systemTotal: number;
  shipmentCount: number;
}

/**
 * Sum of what the system recorded as carrier charges for shipments shipped in
 * [start, end] under one account. Used to sanity-check a bill's statement total
 * against the per-shipment line items the ops sheet recorded for the period.
 * Independent of reconcile — pure aggregate over `shipment_charges`.
 */
export async function systemTotalForPeriod(
  carrierAccountId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodSystemTotal> {
  const [row] = await db
    .select({
      systemTotal: sql<number>`coalesce(sum(${schema.shipmentCharges.totalAmount}), 0)::float8`,
      shipmentCount: sql<number>`count(*)::int`,
    })
    .from(schema.shipmentCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.shipmentCharges.shipmentId))
    .where(and(
      eq(schema.shipmentCharges.carrierAccountId, carrierAccountId),
      gte(sql`${schema.shipments.labelCreatedAt}::date`, periodStart),
      lte(sql`${schema.shipments.labelCreatedAt}::date`, periodEnd),
    ));
  return { systemTotal: Number(row?.systemTotal ?? 0), shipmentCount: Number(row?.shipmentCount ?? 0) };
}
