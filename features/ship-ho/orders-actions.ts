'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { applyMarkup } from './markup';
import { quoteShipHoOrder } from './quote-adapter';
import { requireManageShipHo } from './require-manage';

export interface CreateShipHoOrderInput {
  code: string;
  partnerBrandSlug: string;
  recipientName?: string;
  recipientCompany?: string;
  recipientPhone?: string;
  country: string;
  city?: string;
  province?: string;
  postcode?: string;
  address1?: string;
  address2?: string;
  weightKg: string; // numeric string
  dimLengthCm?: string;
  dimWidthCm?: string;
  dimHeightCm?: string;
  packagingType?: 'bag' | 'box' | null;
  carrierKey?: string;
  carrierAccountId?: string;
  createdBy?: string;
}

export async function createShipHoOrder(
  input: CreateShipHoOrderInput,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  if (!input.code?.trim()) return { ok: false, error: 'Thiếu mã đơn' };
  if (!input.partnerBrandSlug) return { ok: false, error: 'Thiếu partner' };
  if (!input.country?.trim()) return { ok: false, error: 'Thiếu quốc gia' };
  if (!Number.isFinite(Number(input.weightKg)) || Number(input.weightKg) <= 0) {
    return { ok: false, error: 'Cân nặng không hợp lệ' };
  }
  let id: string;
  try {
    const [row] = await db
      .insert(schema.shipHoOrders)
      .values({
        code: input.code.trim(),
        partnerBrandSlug: input.partnerBrandSlug,
        recipientName: input.recipientName || null,
        recipientCompany: input.recipientCompany || null,
        recipientPhone: input.recipientPhone || null,
        country: input.country.trim().toUpperCase(),
        city: input.city || null,
        province: input.province || null,
        postcode: input.postcode || null,
        address1: input.address1 || null,
        address2: input.address2 || null,
        weightKg: input.weightKg,
        dimLengthCm: input.dimLengthCm || null,
        dimWidthCm: input.dimWidthCm || null,
        dimHeightCm: input.dimHeightCm || null,
        packagingType: input.packagingType ?? null,
        carrierKey: input.carrierKey || null,
        carrierAccountId: input.carrierAccountId || null,
        status: 'draft',
        createdBy: input.createdBy || null,
      })
      .returning({ id: schema.shipHoOrders.id });
    id = row.id;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // Auto-quote nếu đã đủ dữ liệu carrier — lỗi quote KHÔNG chặn tạo đơn.
  if (input.carrierAccountId) {
    const q = await requoteShipHoOrder(id);
    if (!q.ok) console.warn('[ship-ho] auto-quote failed', id, q.error);
  }

  revalidatePath('/f/ship-ho');
  return { ok: true, id };
}

/** Tính lại cước + markup, ghi snapshot giá. Đơn giữ 'draft' nếu quote fail. */
export async function requoteShipHoOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [order] = await db.select().from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: 'Không tìm thấy đơn' };
  if (!order.carrierAccountId) return { ok: false, error: 'Chưa chọn carrier account' };

  const [partner] = await db
    .select()
    .from(schema.shipHoPartners)
    .where(eq(schema.shipHoPartners.brandSlug, order.partnerBrandSlug))
    .limit(1);
  const markupPercent = partner?.markupPercent ?? '0';

  const dims =
    order.dimLengthCm && order.dimWidthCm && order.dimHeightCm
      ? {
          lengthCm: Number(order.dimLengthCm),
          widthCm: Number(order.dimWidthCm),
          heightCm: Number(order.dimHeightCm),
        }
      : null;

  const q = await quoteShipHoOrder({
    carrierAccountId: order.carrierAccountId,
    weightKg: Number(order.weightKg),
    dimensions: dims,
    packagingType: (order.packagingType as 'bag' | 'box' | null) ?? null,
    destinationCountry: order.country,
    destinationPostcode: order.postcode ?? undefined,
    destinationCity: order.city ?? undefined,
  });

  if (!q.ok) {
    await db.update(schema.shipHoOrders).set({ status: 'draft' }).where(eq(schema.shipHoOrders.id, orderId));
    return { ok: false, error: `Quote lỗi: ${q.reason}` };
  }

  const charged = applyMarkup(q.carrierCostVnd, Number(markupPercent));
  await db
    .update(schema.shipHoOrders)
    .set({
      carrierCostVnd: String(q.carrierCostVnd),
      markupPercent: String(markupPercent),
      chargedVnd: String(charged),
      quoteBreakdown: q.breakdown,
      quotedAt: new Date(),
      status: 'quoted',
    })
    .where(eq(schema.shipHoOrders.id, orderId));

  revalidatePath('/f/ship-ho');
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}
