'use server';

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { quoteOrderAcrossCarriers, type CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
import { isDefaultResidential } from '@/features/carrier-rates/residential-default';

export interface ShipHoCarrierComparison {
  rows: CarrierQuoteRow[];
  /** Carrier hiện gắn với đơn (snapshot quote / staff đã chọn). */
  selectedKey: string | null;
  /** Giá thu brand (CỐ ĐỊNH theo quote) — để hiện margin dự kiến từng carrier. */
  chargedVnd: number | null;
  weightKg: number | null;
  /** Cân dùng để báo giá: 'sms' = Inecso đo lại, 'declared' = brand khai. */
  weightBasis: 'sms' | 'declared';
  country: string | null;
  error?: string;
}

const numOrNull = (v: string | null) => (v == null ? null : Number(v));

/** Quote đơn ship hộ qua MỌI carrier đang bật — staff chọn line phù hợp nhất
 *  (không mặc định FedEx). Ưu tiên cân/kích thước Inecso đo lại nếu có. */
export async function getShipHoCarrierComparison(orderId: string): Promise<ShipHoCarrierComparison> {
  const [o] = await db.select().from(schema.shipHoOrders)
    .where(eq(schema.shipHoOrders.id, orderId)).limit(1);
  if (!o) return { rows: [], selectedKey: null, chargedVnd: null, weightKg: null, weightBasis: 'declared', country: null, error: 'Không tìm thấy đơn' };

  const sms = numOrNull(o.smsWeightKg);
  const weightBasis: 'sms' | 'declared' = sms != null ? 'sms' : 'declared';
  const weightKg = sms ?? Number(o.weightKg);
  const dim = (l: string | null, w: string | null, h: string | null) =>
    l && w && h ? { lengthCm: Number(l), widthCm: Number(w), heightCm: Number(h) } : null;
  const dimensions = weightBasis === 'sms'
    ? dim(o.smsDimLengthCm, o.smsDimWidthCm, o.smsDimHeightCm)
    : dim(o.dimLengthCm, o.dimWidthCm, o.dimHeightCm);

  const base = {
    selectedKey: o.carrierKey, chargedVnd: numOrNull(o.chargedVnd),
    weightKg, weightBasis, country: o.country,
  };
  if (!o.country || !(weightKg > 0)) return { rows: [], ...base, error: 'Thiếu nước hoặc cân nặng' };

  const rows = await quoteOrderAcrossCarriers({
    country: o.country, weightKg,
    postcode: o.postcode, city: o.city,
    dimensions,
    // Đơn ship hộ chưa qua FedEx Address Validation → mặc định theo nước, giống
    // brand-estimate đang dùng cho cùng đơn.
    isResidential: isDefaultResidential(o.country),
  });
  return { rows, ...base };
}

/**
 * Staff chọn line ship cho đơn ship hộ: cập nhật carrier + SNAPSHOT CHI PHÍ theo
 * carrier đã chọn (carrierCostVnd + quoteBreakdown) để margin/đối soát phản ánh
 * đúng line thật. GIỮ NGUYÊN chargedVnd (giá đã báo brand — hợp đồng).
 */
export async function assignShipHoCarrier(orderId: string, carrierKey: string): Promise<{ ok: boolean; error?: string }> {
  try { await requireManageShipHo(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  // Guard: carrier tạm ngưng thì chặn (không chỉ dựa UI disable).
  const [acc] = await db.select({
    id: schema.carrierAccounts.id,
    suspendedAt: schema.carrierAccounts.suspendedAt,
    reason: schema.carrierAccounts.suspendReason,
  })
    .from(schema.carrierAccounts)
    .innerJoin(schema.carriers, eq(schema.carriers.id, schema.carrierAccounts.carrierId))
    .where(and(eq(schema.carriers.key, carrierKey), eq(schema.carrierAccounts.enabled, true)))
    .limit(1);
  if (!acc) return { ok: false, error: `Không thấy account ${carrierKey} đang bật` };
  if (acc.suspendedAt && acc.suspendedAt <= new Date()) {
    return { ok: false, error: `${carrierKey} đang tạm ngưng${acc.reason ? ` (${acc.reason})` : ''}` };
  }

  // Re-quote carrier đã chọn cho đơn này để lấy chi phí + breakdown làm snapshot.
  const cmp = await getShipHoCarrierComparison(orderId);
  if (cmp.error) return { ok: false, error: cmp.error };
  const row = cmp.rows.find((r) => r.carrierKey === carrierKey);
  if (!row?.ok || row.vndCost == null) {
    return { ok: false, error: `${carrierKey} không báo giá được cho tuyến này${row?.error ? ` (${row.error})` : ''}` };
  }

  await db.update(schema.shipHoOrders).set({
    carrierKey,
    carrierAccountId: acc.id,
    carrierCostVnd: String(Math.round(row.vndCost)),
    quoteBreakdown: row.breakdown,
    // chargedVnd + markupPercent GIỮ NGUYÊN — giá brand không đổi theo line nội bộ.
  }).where(eq(schema.shipHoOrders.id, orderId));

  revalidatePath(`/f/ship-ho/${orderId}`);
  revalidatePath('/f/ship-ho');
  return { ok: true };
}
