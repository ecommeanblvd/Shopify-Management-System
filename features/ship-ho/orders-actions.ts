'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { validateAddressExtra } from '@/lib/geo/address-requirements';
import { emitShipHoEvent } from './mmp-events';
import { internalCodePrefix } from './internal-code';
import { computeOffer } from './offer-pricing';
import { quoteShipHoOrder } from './quote-adapter';
import { requireManageShipHo } from './require-manage';

export interface CreateShipHoOrderInput {
  code: string;
  /** Mã tham chiếu của brand/khách (vd #KLS1996) — hiển thị "Mã đơn gốc" + gửi
   *  MMP làm "Mã shop". KHÔNG phải mã vận hành nội bộ. */
  customerRef?: string;
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
  houseNumber?: string;
  shortAddress?: string;
  mapsUrl?: string;
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
  // Mã trống → tự sinh `YY-INSMS-SV-NNNN` (namespace SMS, không đụng INSLG của
  // MMP) — mã này là mmpRef gửi MMP cho đơn origin sms (contract 20/07).
  let code = input.code?.trim() ?? '';
  // CẤM nhập tay mã namespace INSLG (MMP cấp) — ops gõ tay 26-INSLG-SV-0013 ngày
  // 20/07 đã giẫm counter MMP gây xung đột mã. Đơn SMS: để trống (tự sinh INSMS)
  // hoặc dùng mã tham chiếu của khách.
  if (/-INSLG-/i.test(code)) {
    return { ok: false, error: 'Mã dạng INSLG do MMP cấp — không nhập tay. Để trống để hệ thống tự sinh mã INSMS.' };
  }
  if (!code) {
    // Sequence Postgres — số cấp ra KHÔNG BAO GIỜ tái sử dụng (kể cả khi đơn sau
    // này đổi sang mã MMP), hết cảnh số nhả ra rồi cấp lại gây loạn (bug 21/07).
    const seq = await db.execute(sql`SELECT nextval('ship_ho_insms_seq') AS n`);
    const n = Number((seq.rows[0] as { n?: unknown })?.n ?? 0);
    code = `${internalCodePrefix(new Date())}${String(n).padStart(4, '0')}`;
  }
  if (!input.partnerBrandSlug) return { ok: false, error: 'Thiếu partner' };
  if (!input.country?.trim()) return { ok: false, error: 'Thiếu quốc gia' };
  if (!Number.isFinite(Number(input.weightKg)) || Number(input.weightKg) <= 0) {
    return { ok: false, error: 'Cân nặng không hợp lệ' };
  }
  const extra = validateAddressExtra(input.country, {
    houseNumber: input.houseNumber,
    shortAddress: input.shortAddress,
    mapsUrl: input.mapsUrl,
  });
  if (!extra.ok) return { ok: false, error: extra.error };
  let id: string;
  try {
    const [row] = await db
      .insert(schema.shipHoOrders)
      .values({
        code,
        customerRef: input.customerRef?.trim() || null,
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
        houseNumber: extra.normalized.houseNumber ?? null,
        shortAddress: extra.normalized.shortAddress ?? null,
        mapsUrl: extra.normalized.mapsUrl ?? null,
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

  const { chargedVnd: charged } = computeOffer(q.carrierCostVnd, q.baseVnd, Number(markupPercent), q.breakdown.vatPercent);
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

  // Đơn khởi tạo từ SMS: báo MMP để brand thấy đơn (origin sms, ref = code). Gửi
  // đủ thông tin để MMP TẠO đơn phía họ; requote lại → gửi lại (MMP upsert latest-wins).
  if (order.source !== 'mmp') {
    await emitShipHoEvent(
      { id: order.id, code: order.code, source: order.source, mmpRef: order.mmpRef },
      'order.received',
      {
        brandSlug: order.partnerBrandSlug,
        customerRef: order.customerRef ?? null,
        recipient: {
          name: order.recipientName ?? null,
          company: order.recipientCompany ?? null,
          phone: order.recipientPhone ?? null,
        },
        address: {
          country: order.country,
          city: order.city ?? null,
          province: order.province ?? null,
          postcode: order.postcode ?? null,
          address1: order.address1 ?? null,
          address2: order.address2 ?? null,
          houseNumber: order.houseNumber ?? null,
          shortAddress: order.shortAddress ?? null,
          mapsUrl: order.mapsUrl ?? null,
        },
        country: order.country,
        city: order.city ?? null,
        weightKg: Number(order.weightKg),
        dimLengthCm: order.dimLengthCm == null ? null : Number(order.dimLengthCm),
        dimWidthCm: order.dimWidthCm == null ? null : Number(order.dimWidthCm),
        dimHeightCm: order.dimHeightCm == null ? null : Number(order.dimHeightCm),
        packagingType: order.packagingType ?? null,
        service: 'express',
        chargedVnd: charged,
        createdVia: 'sms',
      },
    );
  }

  revalidatePath('/f/ship-ho');
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}

/** Từ chối đơn brand (mmp) → emit order.rejected cho MMP. Không đổi status đơn ở v1. */
export async function rejectMmpOrder(orderId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [o] = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code, source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'Không tìm thấy đơn' };
  await emitShipHoEvent({ id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef }, 'order.rejected', { reason });
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}

/** Yêu cầu brand (mmp) bổ sung thông tin đơn → emit order.needs_info cho MMP. Không đổi status đơn ở v1. */
export async function requestInfoMmpOrder(orderId: string, reason: string, requiredFields?: string[]): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  const [o] = await db.select({ id: schema.shipHoOrders.id, code: schema.shipHoOrders.code, source: schema.shipHoOrders.source, mmpRef: schema.shipHoOrders.mmpRef })
    .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { ok: false, error: 'Không tìm thấy đơn' };
  await emitShipHoEvent({ id: o.id, code: o.code, source: o.source, mmpRef: o.mmpRef }, 'order.needs_info', { reason, ...(requiredFields?.length ? { requiredFields } : {}) });
  revalidatePath(`/f/ship-ho/${orderId}`);
  return { ok: true };
}

/** Xoá snapshot giá của 1 đơn về draft rồi requote bằng công thức hiện hành. */
export async function clearAndRequoteOrder(orderId: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  await db
    .update(schema.shipHoOrders)
    .set({
      status: 'draft',
      carrierCostVnd: null,
      markupPercent: null,
      chargedVnd: null,
      quoteBreakdown: null,
      quotedAt: null,
    })
    .where(eq(schema.shipHoOrders.id, orderId));
  return await requoteShipHoOrder(orderId);
}
