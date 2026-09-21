/**
 * Duty (thuế/phí nhập khẩu FedEx ứng hộ) của đơn ship hộ — cột RIÊNG, độc lập với đối soát
 * cước (spec 2026-09-21 §4.2). Thu nguyên giá: không markup, không nhiên liệu, không VAT.
 *
 * Hoá đơn duty về sau cước 3–6 tuần, có thể nhiều hoá đơn một đơn. Cộng dồn theo SỐ hoá đơn:
 * hoá đơn đã trong `duty_bill_numbers` không coi là mới; tổng luôn tính lại từ toàn bộ dòng
 * hiện có (FedEx sửa số trên cùng hoá đơn → tổng đổi → ghi đè, bắn lại với cùng số hoá đơn).
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getDutyLinesByTracking, type DongDuty } from './carrier-invoice-lookup';
import { emitShipHoEvent, type ShipHoEmitOrder } from './mmp-events';
import { batTachDuty } from './gia-cuoi-mmp';

export type { DongDuty };

export const GHI_CHU_DUTY = 'Thuế/phí nhập khẩu FedEx ứng hộ, thu đúng nguyên giá, không markup/VAT';

export function tinhDutyMoi(dong: readonly DongDuty[], daCong: readonly string[]): { tong: number; moi: DongDuty[]; billNumbers: string[] } {
  const co = dong.filter((d) => d.dutyVnd > 0);
  const tong = co.reduce((s, d) => s + d.dutyVnd, 0);
  const moi = co.filter((d) => !daCong.includes(d.billNumber));
  return { tong, moi, billNumbers: [...new Set(co.map((d) => d.billNumber))] };
}

/**
 * THUẦN: quyết định có ghi/bắn lại duty hay không, dựa trên tổng CŨ đã lưu (`cu`), toàn bộ
 * dòng duty hiện có (`dong`) và các số hoá đơn đã cộng trước đó (`daCong`).
 *   - Không có dòng nào và chưa từng ghi (`cu == null`) → không ghi.
 *   - Tổng đổi (kể cả FedEx sửa số trên CÙNG hoá đơn) hoặc có hoá đơn MỚI → ghi.
 *   - Không đổi & không có hoá đơn mới → không ghi.
 *   - `canBan` (event bắn MMP): hoá đơn MỚI nếu có; nếu tổng đổi mà không có hoá đơn mới
 *     (FedEx sửa số) → bắn lại DÒNG CUỐI hiện có (rỗng nếu toàn bộ dòng đã bị xoá).
 */
export function quyetDinhGhiDuty(
  cu: number | null, dong: readonly DongDuty[], daCong: readonly string[],
): { ghi: boolean; tong: number; billNumbers: string[]; canBan: DongDuty[]; soMoi: number } {
  const { tong, moi, billNumbers } = tinhDutyMoi(dong, daCong);
  if (dong.length === 0 && cu == null) return { ghi: false, tong: 0, billNumbers: [], canBan: [], soMoi: 0 };
  const tongDoi = cu !== tong;
  if (!tongDoi && moi.length === 0) return { ghi: false, tong, billNumbers, canBan: [], soMoi: 0 };
  const canBan = moi.length > 0 ? moi : dong.slice(-1);
  // soMoi = số hoá đơn LẦN ĐẦU được cộng (không tính lượt "FedEx sửa số" phát lại hoá đơn cũ).
  return { ghi: true, tong, billNumbers, canBan, soMoi: moi.length };
}

export interface DonChoDuty extends ShipHoEmitOrder {
  trackingNumber: string | null; shippedAt: string | null;
  actualDutyVnd: string | null; dutyBillNumbers: string[] | null;
}

/** Đọc dòng duty của đơn, ghi cột, bắn `order.duty_charged` cho hoá đơn mới (hoặc tổng đổi). */
export async function ghiDutyChoDon(o: DonChoDuty): Promise<{ daGhi: boolean; tong: number; moi: number }> {
  if (!o.trackingNumber) return { daGhi: false, tong: 0, moi: 0 };
  const dong = await getDutyLinesByTracking(o.trackingNumber);
  const daCong = o.dutyBillNumbers ?? [];
  const cu = o.actualDutyVnd == null ? null : Math.round(Number(o.actualDutyVnd));
  const { ghi, tong, billNumbers, canBan, soMoi } = quyetDinhGhiDuty(cu, dong, daCong);
  if (!ghi) return { daGhi: false, tong, moi: 0 };

  await db.update(schema.shipHoOrders)
    .set({ actualDutyVnd: String(tong), dutyBillNumbers: billNumbers })
    .where(eq(schema.shipHoOrders.id, o.id));

  if (batTachDuty()) {
    for (const d of canBan) {
      await emitShipHoEvent(o, 'order.duty_charged', {
        dutyVnd: tong, addedVnd: d.dutyVnd, fedexInvoiceNumber: d.billNumber, invoiceDate: d.issueDate,
        shippedAt: o.shippedAt, trackingNumber: o.trackingNumber, note: GHI_CHU_DUTY,
      });
    }
  }
  return { daGhi: true, tong, moi: soMoi };
}
