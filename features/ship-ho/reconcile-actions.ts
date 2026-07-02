'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { parseCarrierInvoiceRow, computeReconcile } from './reconcile-logic';

export interface ReconcileSummary {
  total: number;
  matched: number;
  unmatched: number;
  skippedEmpty: number;
  errors: Array<{ rowIndex: number; reason: string }>;
  dryRun: boolean;
}

/**
 * Đối soát cước carrier thực cho đơn ship hộ: match theo trackingNumber, ghi
 * actualCarrierCostVnd + deltaVnd (actual−estimate) + marginVnd (charged−actual)
 * + reconcileStatus. Tracking không khớp → bucket unmatched (không tạo mới).
 */
export async function importCarrierInvoice(
  rows: readonly unknown[][],
  opts?: { dryRun?: boolean },
): Promise<ReconcileSummary> {
  await requireManageShipHo();
  const dryRun = opts?.dryRun ?? false;
  const summary: ReconcileSummary = { total: rows.length, matched: 0, unmatched: 0, skippedEmpty: 0, errors: [], dryRun };

  const parsed: Array<{ trackingNumber: string; actualCostVnd: number }> = [];
  rows.forEach((row, i) => {
    const r = parseCarrierInvoiceRow(row);
    if (r.kind === 'ok') parsed.push({ trackingNumber: r.trackingNumber, actualCostVnd: r.actualCostVnd });
    else if (r.kind === 'skip_empty') summary.skippedEmpty += 1;
    else summary.errors.push({ rowIndex: i, reason: r.reason });
  });
  if (parsed.length === 0) return summary;

  const trackings = parsed.map((p) => p.trackingNumber);
  const orders = await db
    .select({
      id: schema.shipHoOrders.id,
      trackingNumber: schema.shipHoOrders.trackingNumber,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
    })
    .from(schema.shipHoOrders)
    .where(inArray(schema.shipHoOrders.trackingNumber, trackings));
  const byTracking = new Map(orders.map((o) => [o.trackingNumber, o]));

  for (const p of parsed) {
    const o = byTracking.get(p.trackingNumber);
    if (!o) { summary.unmatched += 1; continue; }
    summary.matched += 1;
    if (dryRun) continue;
    const rec = computeReconcile({
      estimateVnd: o.carrierCostVnd == null ? null : Number(o.carrierCostVnd),
      chargedVnd: o.chargedVnd == null ? null : Number(o.chargedVnd),
      actualVnd: p.actualCostVnd,
    });
    await db.update(schema.shipHoOrders).set({
      actualCarrierCostVnd: String(p.actualCostVnd),
      deltaVnd: rec.deltaVnd == null ? null : String(rec.deltaVnd),
      marginVnd: rec.marginVnd == null ? null : String(rec.marginVnd),
      reconcileStatus: rec.reconcileStatus,
    }).where(eq(schema.shipHoOrders.id, o.id));
  }

  if (!dryRun) revalidatePath('/f/ship-ho');
  return summary;
}
