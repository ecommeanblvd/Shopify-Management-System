'use server';

import { eq, inArray, isNotNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { parseCarrierInvoiceRow, computeReconcile } from './reconcile-logic';
import { getBilledByTracking } from './carrier-invoice-lookup';
import { estimateForBrand } from './brand-estimate';
import { displayMargin } from './pnl';
import { emitShipHoEvent } from './mmp-events';

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

export interface RebillSummary {
  totalWithTracking: number;
  matched: number;      // có dòng bill khớp tracking
  requoted: number;     // tính lại được giá thu thực (có cân thực)
  unmatched: number;    // chưa có bill cho tracking
  errors: Array<{ code: string; reason: string }>;
}

/** Nút operator (auth) → đối soát ship hộ từ hoá đơn carrier. */
export async function reconcileShipHoFromCarrierBills(): Promise<RebillSummary> {
  await requireManageShipHo();
  const summary = await reconcileShipHoFromCarrierBillsCore();
  revalidatePath('/f/ship-ho');
  return summary;
}

/**
 * LÕI không-auth (cron hourly + nút operator): RE-BILL theo cân thực — với mọi
 * đơn ship hộ có tracking, lookup hoá đơn carrier đã upload (carrier_bill_lines)
 * → kéo cân thực + cước thực + phụ phí thực về đơn, tính LẠI giá thu brand trên
 * cân thực (fuel tuần giao hàng theo ship_date), ghi actual* + margin/delta +
 * breakdown. Đơn MỚI đối soát lần đầu (hoặc giá cuối đổi) → emit `order.reconciled`
 * sang MMP (giá cuối, KHÔNG lộ cước carrier). Idempotent theo bill mới nhất.
 */
export async function reconcileShipHoFromCarrierBillsCore(): Promise<RebillSummary> {
  const summary: RebillSummary = { totalWithTracking: 0, matched: 0, requoted: 0, unmatched: 0, errors: [] };

  const orders = await db
    .select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      source: schema.shipHoOrders.source,
      mmpRef: schema.shipHoOrders.mmpRef,
      brandSlug: schema.shipHoOrders.partnerBrandSlug,
      country: schema.shipHoOrders.country,
      city: schema.shipHoOrders.city,
      postcode: schema.shipHoOrders.postcode,
      packagingType: schema.shipHoOrders.packagingType,
      trackingNumber: schema.shipHoOrders.trackingNumber,
      carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
      chargedVnd: schema.shipHoOrders.chargedVnd,
      prevActualChargedVnd: schema.shipHoOrders.actualChargedVnd,
      prevReconcile: schema.shipHoOrders.reconcileStatus,
    })
    .from(schema.shipHoOrders)
    .where(isNotNull(schema.shipHoOrders.trackingNumber));
  summary.totalWithTracking = orders.length;

  for (const o of orders) {
    const billed = await getBilledByTracking(o.trackingNumber ?? '');
    if (!billed) { summary.unmatched += 1; continue; }
    summary.matched += 1;

    // Re-quote giá thu THỰC trên cân thực + fuel tuần giao (ship_date), dims null
    // vì cân bill ĐÃ là chargeable weight của carrier.
    let actualChargedVnd: number | null = null;
    if (billed.weightKg != null && billed.weightKg > 0) {
      const asOf = billed.shipDate ? new Date(`${billed.shipDate}T00:00:00Z`) : undefined;
      const est = await estimateForBrand(o.brandSlug, {
        country: o.country, city: o.city ?? undefined, postcode: o.postcode ?? undefined,
        weightKg: billed.weightKg, packagingType: (o.packagingType as 'bag' | 'box' | null) ?? undefined,
        service: 'express',
      }, asOf);
      if (est.ok) { actualChargedVnd = est.estimate.chargedVnd; summary.requoted += 1; }
      else summary.errors.push({ code: o.code, reason: `re-quote ${est.code}` });
    }

    const quotedCharged = o.chargedVnd == null ? null : Number(o.chargedVnd);
    const estCost = o.carrierCostVnd == null ? null : Number(o.carrierCostVnd);
    const margin = displayMargin(quotedCharged, actualChargedVnd, estCost, billed.totalVnd);
    const deltaVnd = estCost == null ? null : Math.round(billed.totalVnd - estCost);

    await db.update(schema.shipHoOrders).set({
      actualCarrierCostVnd: String(billed.totalVnd),
      actualWeightKg: billed.weightKg == null ? null : String(billed.weightKg),
      actualChargedVnd: actualChargedVnd == null ? null : String(actualChargedVnd),
      deltaVnd: deltaVnd == null ? null : String(deltaVnd),
      marginVnd: margin.vnd == null ? null : String(margin.vnd),
      actualBillBreakdown: { ...billed.surcharges, billNumber: billed.billNumber, shipDate: billed.shipDate },
      reconcileStatus: 'reconciled',
    }).where(eq(schema.shipHoOrders.id, o.id));

    // Giá cuối cho brand (contract: order.reconciled). Chỉ bắn khi MỚI đối soát
    // lần đầu hoặc giá cuối ĐỔI (idempotent qua các lượt cron). Không lộ cước carrier.
    const finalChargedVnd = actualChargedVnd ?? quotedCharged;
    const prevFinal = o.prevActualChargedVnd == null ? null : Math.round(Number(o.prevActualChargedVnd));
    const isNew = o.prevReconcile !== 'reconciled';
    if (finalChargedVnd != null && (isNew || (actualChargedVnd != null && actualChargedVnd !== prevFinal))) {
      await emitShipHoEvent(
        { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
        'order.reconciled',
        {
          finalChargedVnd,
          previousChargedVnd: quotedCharged,
          deltaVnd: quotedCharged == null ? null : finalChargedVnd - quotedCharged,
          billedWeightKg: billed.weightKg,
        },
      );
    }
  }

  // KHÔNG revalidatePath ở core — cron chạy ngoài request context (trang ship hộ
  // force-dynamic nên luôn fresh); wrapper action lo revalidate khi bấm nút.
  return summary;
}
