'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';

export interface SmsMeasurementInput {
  weightKg: number;
  dimLengthCm?: number | null;
  dimWidthCm?: number | null;
  dimHeightCm?: number | null;
}

/**
 * Nhân viên vận hành SMS cân & đo LẠI kiện khi hàng về kho → lưu để đối chiếu với
 * số brand khai bên MMP. KHÔNG ghi đè cân khai báo (weightKg gốc giữ nguyên làm
 * bằng chứng); chênh lệch hiển thị ở trang chi tiết đơn.
 */
export async function updateSmsMeasurement(
  orderId: string,
  input: SmsMeasurementInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
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

  await db.update(schema.shipHoOrders).set({
    smsWeightKg: String(input.weightKg),
    smsDimLengthCm: l, smsDimWidthCm: w, smsDimHeightCm: h,
    smsMeasuredAt: new Date(), smsMeasuredBy: userId,
  }).where(eq(schema.shipHoOrders.id, orderId));

  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true };
}
