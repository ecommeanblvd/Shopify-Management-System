'use server';

import { eq, inArray, isNotNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { parseCarrierInvoiceRow, computeReconcile } from './reconcile-logic';
import { getBilledByTracking } from './carrier-invoice-lookup';
import { estimateForBrand } from './brand-estimate';
import { reconciledBrandCharge } from './reconcile-charge';
import { displayMargin } from './pnl';
import { emitShipHoEvent } from './mmp-events';
import { decideReconcile } from './reconcile-decision';

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
      prevDecision: schema.shipHoOrders.reconcileDecision,
      dimLengthCm: schema.shipHoOrders.dimLengthCm,
      dimWidthCm: schema.shipHoOrders.dimWidthCm,
      dimHeightCm: schema.shipHoOrders.dimHeightCm,
      smsDimLengthCm: schema.shipHoOrders.smsDimLengthCm,
      smsDimWidthCm: schema.shipHoOrders.smsDimWidthCm,
      smsDimHeightCm: schema.shipHoOrders.smsDimHeightCm,
    })
    .from(schema.shipHoOrders)
    .where(isNotNull(schema.shipHoOrders.trackingNumber));
  summary.totalWithTracking = orders.length;

  for (const o of orders) {
    const billed = await getBilledByTracking(o.trackingNumber ?? '');
    if (!billed) { summary.unmatched += 1; continue; }
    summary.matched += 1;

    // Re-quote giá thu THỰC: cột cân trên bill FBO là CÂN THỰC trên cân (scale),
    // KHÔNG phải cân tính cước — carrier tính trên max(cân thực, dim weight) làm
    // tròn bậc 0.5kg (kiểm chứng: net freight từng bill khớp đúng ô tier đó).
    // → truyền cả dims (SMS đo ?? brand khai) để engine tính chargeable như carrier.
    // Giá thu THỰC dựng theo công thức FedEx: cước cơ bản (bảng offer, cân bill) +
    // phụ phí LẤY THEO BILL (pass-through, gồm residential/ký nhận quote không có)
    // + fuel trên (base+phụ phí vận chuyển) + VAT bước cuối (gồm cả customs).
    let actualChargedVnd: number | null = null;
    let billedChargeableKg: number | null = null;
    let sellBreakdown: Record<string, number> | null = null;
    if (billed.weightKg != null && billed.weightKg > 0) {
      const asOf = billed.shipDate ? new Date(`${billed.shipDate}T00:00:00Z`) : undefined;
      const dim = (sms: string | null, decl: string | null) => {
        const v = sms ?? decl; return v == null ? undefined : Number(v);
      };
      const est = await estimateForBrand(o.brandSlug, {
        country: o.country, city: o.city ?? undefined, postcode: o.postcode ?? undefined,
        weightKg: billed.weightKg, packagingType: (o.packagingType as 'bag' | 'box' | null) ?? undefined,
        dimLengthCm: dim(o.smsDimLengthCm, o.dimLengthCm),
        dimWidthCm: dim(o.smsDimWidthCm, o.dimWidthCm),
        dimHeightCm: dim(o.smsDimHeightCm, o.dimHeightCm),
        service: 'express',
      }, asOf);
      if (est.ok) {
        const bd = est.internal.breakdown as { chargeableWeightKg?: unknown } | null;
        const ch = bd && typeof bd.chargeableWeightKg === 'number' ? bd.chargeableWeightKg : null;
        billedChargeableKg = ch ?? billed.weightKg;
        // Phụ phí VẬN CHUYỂN từ bill (fuel áp lên): vùng xa + demand + giao nhà dân + ký nhận.
        // signature nay ĐÃ tách residential ra → cộng lại cả 2 để tổng KHÔNG đổi.
        const s = billed.surcharges;
        // AC (sửa địa chỉ) cũng là phụ phí VẬN CHUYỂN: FedEx áp fuel lên nó
        // (fuel bill = %(freight + AC), kiểm chứng bill 734105850).
        const transportSur = s.remote + s.demand + s.signature + s.residential + s.addressCorrection;
        // Tách 3 khoản rõ ràng (21/07): NK + other-chưa-phân-loại → customs bucket
        // (không fuel, có VAT); duty → pass-through thuần (không fuel, KHÔNG VAT).
        const customsSur = s.importHandling + s.other;
        const dutySur = s.duty;
        const rc = reconciledBrandCharge({
          baseVnd: est.internal.baseVnd, markupPercent: est.internal.markupPercent,
          transportSurchargesVnd: transportSur, customsSurchargesVnd: customsSur, dutyVnd: dutySur,
          fuelPercent: est.internal.fuelPercent, vatPercent: est.internal.vatPercent,
          serviceLabel: 'Express Delivery',
        });
        actualChargedVnd = rc.chargedVnd;
        sellBreakdown = {
          baseVnd: rc.markedBaseVnd, transportSurVnd: Math.round(transportSur), customsSurVnd: Math.round(customsSur),
          remoteVnd: Math.round(s.remote), demandVnd: Math.round(s.demand),
          // resSignVnd giữ lại (tổng cũ) để tương thích; thêm 2 khoản TÁCH cho bảng đối soát.
          resSignVnd: Math.round(s.signature + s.residential),
          residentialVnd: Math.round(s.residential), signatureVnd: Math.round(s.signature),
          acVnd: Math.round(s.addressCorrection),
          importHandlingVnd: Math.round(s.importHandling), dutyVnd: Math.round(dutySur), otherVnd: Math.round(s.other),
          fuelVnd: rc.fuelVnd, fuelPercent: est.internal.fuelPercent,
          processingExVatVnd: rc.processingExVatVnd, vatVnd: rc.vatVnd, vatPercent: est.internal.vatPercent,
          chargedVnd: rc.chargedVnd,
        };
        summary.requoted += 1;
      } else summary.errors.push({ code: o.code, reason: `re-quote ${est.code}` });
    }

    const quotedCharged = o.chargedVnd == null ? null : Number(o.chargedVnd);
    const estCost = o.carrierCostVnd == null ? null : Number(o.carrierCostVnd);
    const margin = displayMargin(quotedCharged, actualChargedVnd, estCost, billed.totalVnd);
    const deltaVnd = estCost == null ? null : Math.round(billed.totalVnd - estCost);

    // actualWeightKg = CÂN TÍNH CƯỚC carrier dùng (chargeable) — thứ mọi chỗ hiển
    // thị gọi là "cân bill"; cân thực trên cân giữ ở breakdown (scaleWeightKg).
    const kgToStore = billedChargeableKg ?? billed.weightKg;

    // Sai lệch cost thực vs dự tính → cần operator DUYỆT TAY (accept/claim) trước
    // khi đẩy giá; khớp → tự đẩy như cũ. Quyết định đã chốt → giữ (không ghi đè).
    const { decision: nextDecision, shouldEmitCharge } = decideReconcile(deltaVnd, o.prevDecision);

    await db.update(schema.shipHoOrders).set({
      actualCarrierCostVnd: String(billed.totalVnd),
      actualWeightKg: kgToStore == null ? null : String(kgToStore),
      actualChargedVnd: actualChargedVnd == null ? null : String(actualChargedVnd),
      deltaVnd: deltaVnd == null ? null : String(deltaVnd),
      marginVnd: margin.vnd == null ? null : String(margin.vnd),
      actualBillBreakdown: {
        ...billed.surcharges, billNumber: billed.billNumber, shipDate: billed.shipDate,
        scaleWeightKg: billed.weightKg,
        sell: sellBreakdown, // breakdown giá thu THỰC (để bảng đối soát hiện cột thu đúng phụ phí bill).
      },
      reconcileStatus: 'reconciled',
      reconcileDecision: nextDecision,
    }).where(eq(schema.shipHoOrders.id, o.id));

    // Đẩy giá chính thức (order.reconciled) CHỈ KHI shouldEmitCharge (tự khớp hoặc
    // đã 'accepted'). 'pending_review'/'claiming' → chưa đẩy. Chỉ bắn khi MỚI đối
    // soát / giá cuối ĐỔI (idempotent). Không lộ cước carrier.
    const finalChargedVnd = actualChargedVnd ?? quotedCharged;
    const prevFinal = o.prevActualChargedVnd == null ? null : Math.round(Number(o.prevActualChargedVnd));
    const isNew = o.prevReconcile !== 'reconciled';
    if (shouldEmitCharge && finalChargedVnd != null && (isNew || (actualChargedVnd != null && actualChargedVnd !== prevFinal))) {
      await emitShipHoEvent(
        { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
        'order.reconciled',
        {
          finalChargedVnd,
          previousChargedVnd: quotedCharged,
          deltaVnd: quotedCharged == null ? null : finalChargedVnd - quotedCharged,
          billedWeightKg: kgToStore,
          scaleWeightKg: billed.weightKg,
        },
      );
    }

    // Đơn CÓ sai lệch → 'pending_review' (chờ operator duyệt): báo MMP "chờ đối soát",
    // GIỮ giá dự tính (KHÔNG gửi giá thực tới khi accept/claim). Chỉ emit khi MỚI
    // chuyển sang pending_review (tránh spam mỗi lượt cron).
    if (nextDecision === 'pending_review' && o.prevDecision !== 'pending_review') {
      await emitShipHoEvent(
        { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
        'order.reconcile_pending',
        { estimatedCostVnd: estCost, billedCostVnd: Math.round(billed.totalVnd), deltaVnd },
      );
    }
  }

  // KHÔNG revalidatePath ở core — cron chạy ngoài request context (trang ship hộ
  // force-dynamic nên luôn fresh); wrapper action lo revalidate khi bấm nút.
  return summary;
}
