'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { estimateForBrand } from './brand-estimate';
import { emitShipHoEvent } from './mmp-events';

export interface SmsMeasurementInput {
  weightKg: number;
  dimLengthCm?: number | null;
  dimWidthCm?: number | null;
  dimHeightCm?: number | null;
}

export type SmsMeasurementResult =
  | { ok: true; priceChange: { oldVnd: number; newVnd: number } | null }
  | { ok: false; error: string };

/**
 * Nhân viên vận hành SMS cân & đo LẠI kiện khi hàng về kho → lưu để đối chiếu với
 * số brand khai bên MMP (KHÔNG ghi đè cân khai báo gốc — giữ làm bằng chứng).
 *
 * Hàng chắc chắn vẫn gửi đi; nhưng nếu số đo mới làm GIÁ THU đổi (kg/thể tích →
 * bậc cân khác, phụ phí đổi) thì re-quote theo số đo SMS, cập nhật giá dự tính
 * của đơn và bắn event `order.priced` sang MMP NGAY để brand biết giá mới.
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
  if (est.ok && oldVnd != null && est.estimate.chargedVnd !== oldVnd) {
    const newVnd = est.estimate.chargedVnd;
    // Cập nhật snapshot giá dự tính theo số đo SMS (giá brand sẽ trả).
    await db.update(schema.shipHoOrders).set({
      carrierKey: est.internal.carrierKey, carrierAccountId: est.internal.carrierAccountId,
      carrierCostVnd: String(est.internal.carrierCostVnd), markupPercent: String(est.internal.markupPercent),
      quoteBreakdown: est.internal.breakdown,
      chargedVnd: String(newVnd), quotedAt: new Date(),
    }).where(eq(schema.shipHoOrders.id, orderId));

    // Báo MMP NGAY: giá mới + chênh + lý do (đo lại tại kho SMS) + số đo + lines mới.
    await emitShipHoEvent(
      { id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef },
      'order.priced',
      {
        chargedVnd: newVnd,
        previousChargedVnd: oldVnd,
        deltaVnd: newVnd - oldVnd,
        reason: 'sms_remeasure',
        measured: {
          weightKg: input.weightKg,
          dimLengthCm: input.dimLengthCm ?? null,
          dimWidthCm: input.dimWidthCm ?? null,
          dimHeightCm: input.dimHeightCm ?? null,
        },
        lines: est.estimate.lines,
      },
    );
    priceChange = { oldVnd, newVnd };
  }

  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true, priceChange };
}
