'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { estimateForBrand } from './brand-estimate';
import { emitShipHoEvent } from './mmp-events';
import { buildMeasurementEventData } from './measure-event';

export interface SmsMeasurementInput {
  weightKg: number;
  dimLengthCm?: number | null;
  dimWidthCm?: number | null;
  dimHeightCm?: number | null;
}

export type SmsMeasurementResult =
  | { ok: true; matched: boolean; priceChange: { oldVnd: number; newVnd: number } | null }
  | { ok: false; error: string };

/**
 * Nhân viên vận hành SMS (Inecso) cân & đo LẠI kiện khi hàng về kho → lưu để đối
 * chiếu với số brand khai bên MMP (KHÔNG ghi đè cân khai báo gốc — giữ làm bằng chứng).
 *
 * Sau khi đo, LUÔN bắn event `order.measured` sang MMP để ghi lên đơn của brand:
 * khớp → thông báo khớp (matched=true); lệch → số đo mới + delta; giá thu đổi sau
 * re-quote → kèm block price (giá cũ/mới/chênh + lines mới). Hàng vẫn gửi đi bình thường.
 */
export async function updateSmsMeasurement(
  orderId: string,
  input: SmsMeasurementInput,
): Promise<SmsMeasurementResult> {
  let userId: string;
  try { userId = await requireManageShipHo(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    return { ok: false, error: 'Cân nặng phải > 0' };
  }
  const dim = (v: number | null | undefined) =>
    v == null || v === 0 ? null : (Number.isFinite(v) && v > 0 ? String(v) : undefined);
  const l = dim(input.dimLengthCm), w = dim(input.dimWidthCm), h = dim(input.dimHeightCm);
  if (l === undefined || w === undefined || h === undefined) {
    return { ok: false, error: 'Kích thước phải > 0 (hoặc bỏ trống)' };
  }

  const [o] = await db.select().from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'Không tìm thấy đơn' };

  await db.update(schema.shipHoOrders).set({
    smsWeightKg: String(input.weightKg),
    smsDimLengthCm: l, smsDimWidthCm: w, smsDimHeightCm: h,
    smsMeasuredAt: new Date(), smsMeasuredBy: userId,
  }).where(eq(schema.shipHoOrders.id, orderId));

  // Re-quote theo số đo SMS (engine tự lấy max(cân, dim weight)). Lỗi re-quote
  // (vd đơn nội bộ không có partner MMP) → vẫn lưu số đo, không đổi giá.
  let priceChange: { oldVnd: number; newVnd: number } | null = null;
  const est = await estimateForBrand(o.partnerBrandSlug, {
    country: o.country, city: o.city ?? undefined, postcode: o.postcode ?? undefined,
    weightKg: input.weightKg,
    dimLengthCm: input.dimLengthCm ?? undefined,
    dimWidthCm: input.dimWidthCm ?? undefined,
    dimHeightCm: input.dimHeightCm ?? undefined,
    packagingType: (o.packagingType as 'bag' | 'box' | null) ?? undefined,
    service: 'express',
  });
  const oldVnd = o.chargedVnd == null ? null : Math.round(Number(o.chargedVnd));
  let newVnd = oldVnd;
  if (est.ok && oldVnd != null && est.estimate.chargedVnd !== oldVnd) {
    newVnd = est.estimate.chargedVnd;
    // Cập nhật snapshot giá dự tính theo số đo SMS (giá brand sẽ trả).
    await db.update(schema.shipHoOrders).set({
      carrierKey: est.internal.carrierKey, carrierAccountId: est.internal.carrierAccountId,
      carrierCostVnd: String(est.internal.carrierCostVnd), markupPercent: String(est.internal.markupPercent),
      quoteBreakdown: est.internal.breakdown,
      chargedVnd: String(newVnd), quotedAt: new Date(),
    }).where(eq(schema.shipHoOrders.id, orderId));
    priceChange = { oldVnd, newVnd };
  }

  // LUÔN báo MMP kết quả đo (khớp hay lệch) để ghi lên đơn của brand.
  const eventData = buildMeasurementEventData(
    {
      weightKg: Number(o.weightKg),
      dimLengthCm: o.dimLengthCm == null ? null : Number(o.dimLengthCm),
      dimWidthCm: o.dimWidthCm == null ? null : Number(o.dimWidthCm),
      dimHeightCm: o.dimHeightCm == null ? null : Number(o.dimHeightCm),
    },
    {
      weightKg: input.weightKg,
      dimLengthCm: input.dimLengthCm ?? null,
      dimWidthCm: input.dimWidthCm ?? null,
      dimHeightCm: input.dimHeightCm ?? null,
    },
    { previousChargedVnd: oldVnd, chargedVnd: newVnd, lines: est.ok ? est.estimate.lines : undefined },
  );
  await emitShipHoEvent(
    { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
    'order.measured',
    eventData,
  );

  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true, matched: eventData.matched, priceChange };
}
