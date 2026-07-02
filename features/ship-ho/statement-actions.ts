'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { summarizeStatement } from './statement-logic';

/** Gom đơn đủ điều kiện bill của partner trong kỳ (có chargedVnd, chưa vào kê,
 *  đã gửi/giao, quotedAt trong [start,end]) → tạo ship_ho_statements + gán. */
export async function generateStatement(
  partnerBrandSlug: string,
  periodStart: string,
  periodEnd: string,
  opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string; statementId?: string; orderCount: number; totalChargedVnd: number; dryRun: boolean }> {
  await requireManageShipHo();
  const dryRun = opts?.dryRun ?? false;
  if (!partnerBrandSlug) return { ok: false, error: 'Thiếu partner', orderCount: 0, totalChargedVnd: 0, dryRun };
  if (!periodStart || !periodEnd) return { ok: false, error: 'Thiếu kỳ', orderCount: 0, totalChargedVnd: 0, dryRun };

  const orders = await db
    .select({ id: schema.shipHoOrders.id, chargedVnd: schema.shipHoOrders.chargedVnd })
    .from(schema.shipHoOrders)
    .where(and(
      eq(schema.shipHoOrders.partnerBrandSlug, partnerBrandSlug),
      sql`${schema.shipHoOrders.chargedVnd} is not null`,
      isNull(schema.shipHoOrders.statementId),
      inArray(schema.shipHoOrders.status, ['shipped', 'delivered'] as ('shipped' | 'delivered')[]),
      sql`${schema.shipHoOrders.quotedAt}::date >= ${periodStart}`,
      sql`${schema.shipHoOrders.quotedAt}::date <= ${periodEnd}`,
    ));

  const sums = summarizeStatement(orders.map((o) => Number(o.chargedVnd)));
  if (dryRun || orders.length === 0) {
    return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, dryRun };
  }

  const [st] = await db.insert(schema.shipHoStatements).values({
    partnerBrandSlug,
    periodStart,
    periodEnd,
    orderCount: sums.orderCount,
    totalChargedVnd: String(sums.totalChargedVnd),
    status: 'draft',
  }).returning({ id: schema.shipHoStatements.id });

  await db.update(schema.shipHoOrders)
    .set({ statementId: st.id, status: 'billed' })
    .where(inArray(schema.shipHoOrders.id, orders.map((o) => o.id)));

  revalidatePath('/f/ship-ho/statements');
  return { ok: true, statementId: st.id, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, dryRun };
}

/** issued: đánh dấu đã gửi partner. paid: đã thu → đơn trong kê chuyển 'settled'. */
export async function setStatementStatus(
  id: string,
  status: 'issued' | 'paid',
): Promise<{ ok: boolean; error?: string }> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (status === 'issued') {
    await db.update(schema.shipHoStatements).set({ status: 'issued', issuedAt: new Date() }).where(eq(schema.shipHoStatements.id, id));
  } else {
    await db.update(schema.shipHoStatements).set({ status: 'paid', paidAt: new Date() }).where(eq(schema.shipHoStatements.id, id));
    await db.update(schema.shipHoOrders).set({ status: 'settled' }).where(eq(schema.shipHoOrders.statementId, id));
  }
  revalidatePath('/f/ship-ho/statements');
  return { ok: true };
}
