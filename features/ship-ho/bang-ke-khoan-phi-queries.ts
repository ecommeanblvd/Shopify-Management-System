/**
 * Đọc khoản phí chi tiết của các đơn trong một bảng kê, để gắn vào payload gửi MMP.
 *
 * CỐ Ý KHÔNG có `'use server'`: hàm chạy phía máy chủ dùng chung, không phải endpoint cho
 * trình duyệt gọi — cùng lý do đã ghi ở `anh-lark.ts`.
 *
 * Tách khỏi truy vấn bảng kê thay vì nống nó thêm 6 cột: truy vấn đó phục vụ màn hình và bản
 * xuất, còn đây là việc của payload. Đọc CẢ LÔ một lượt, không hỏi từng đơn.
 */
import { inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { shipHoPriceStructure } from './price-structure';
import { bocKhoanPhi, type KhoanPhiMmp } from './bang-ke-khoan-phi';

export interface KhoanPhiDon {
  fees: KhoanPhiMmp[];
  /** Tổng các khoản — PHẢI bằng `amountVnd` của đơn trong bảng kê. */
  feesTotalVnd: number;
  carrier: string | null;
  country: string | null;
  weightKg: number | null;
  /** Cân hãng dùng để tính cước (có thể khác cân thực do quy đổi kích thước). */
  chargeableWeightKg: number | null;
  dimensions: string | null;
}

const kt = (l: unknown, w: unknown, h: unknown): string | null =>
  l == null || w == null || h == null ? null : `${Number(l)}x${Number(w)}x${Number(h)}`;

export async function khoanPhiChoBangKe(
  codes: readonly string[],
  /** Loại bảng kê — quyết định khoản nào thuộc về nó (xem `bocKhoanPhi`). */
  loai: 'freight' | 'duty' = 'freight',
): Promise<Map<string, KhoanPhiDon>> {
  const ra = new Map<string, KhoanPhiDon>();
  if (codes.length === 0) return ra;

  const rows = await db.select({
    code: schema.shipHoOrders.code,
    quoteBreakdown: schema.shipHoOrders.quoteBreakdown,
    carrierCostVnd: schema.shipHoOrders.carrierCostVnd,
    chargedVnd: schema.shipHoOrders.chargedVnd,
    markupPercent: schema.shipHoOrders.markupPercent,
    service: schema.shipHoOrders.service,
    actualBillBreakdown: schema.shipHoOrders.actualBillBreakdown,
    actualCarrierCostVnd: schema.shipHoOrders.actualCarrierCostVnd,
    actualWeightKg: schema.shipHoOrders.actualWeightKg,
    actualDutyVnd: schema.shipHoOrders.actualDutyVnd,
    carrierKey: schema.shipHoOrders.carrierKey,
    country: schema.shipHoOrders.country,
    weightKg: schema.shipHoOrders.weightKg,
    l: schema.shipHoOrders.dimLengthCm, w: schema.shipHoOrders.dimWidthCm, h: schema.shipHoOrders.dimHeightCm,
  }).from(schema.shipHoOrders).where(inArray(schema.shipHoOrders.code, [...codes]));

  for (const o of rows) {
    const s = shipHoPriceStructure({
      breakdown: o.quoteBreakdown,
      carrierCostVnd: Number(o.carrierCostVnd ?? 0),
      chargedVnd: Number(o.chargedVnd ?? 0),
      markupPercent: Number(o.markupPercent ?? 0),
      serviceLabel: o.service ?? undefined,
      actualBill: {
        breakdown: o.actualBillBreakdown,
        totalVnd: Number(o.actualCarrierCostVnd ?? 0),
        weightKg: o.actualWeightKg == null ? null : Number(o.actualWeightKg),
      },
      // Duty lấy từ CỘT — bản sao trong breakdown chậm vài tuần (xem price-structure.ts).
      actualDutyVnd: o.actualDutyVnd == null ? null : Number(o.actualDutyVnd),
    });
    const b = bocKhoanPhi(s, loai, o.actualDutyVnd == null ? null : Number(o.actualDutyVnd));
    /* Nhãn chưa ánh xạ = payload THIẾU TIỀN mà không ai biết. Ghi nhật ký to tiếng: test canh
     * được ca đã biết, còn ca mới chỉ lộ ra ở đây, trên dữ liệu thật. */
    if (b.nhanLa.length > 0) console.error(`[bảng kê MMP] đơn ${o.code} có khoản phí CHƯA ánh xạ mã: ${b.nhanLa.join(' | ')}`);
    ra.set(o.code, {
      fees: b.fees, feesTotalVnd: b.totalVnd,
      carrier: o.carrierKey, country: o.country,
      weightKg: o.weightKg == null ? null : Number(o.weightKg),
      chargeableWeightKg: o.actualWeightKg == null ? null : Number(o.actualWeightKg),
      dimensions: kt(o.l, o.w, o.h),
    });
  }
  return ra;
}
