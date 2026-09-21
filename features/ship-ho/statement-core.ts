/**
 * Lõi không-auth cho bảng kê ship hộ: tính lại tổng một bảng kê còn NHÁP theo LOẠI —
 * cước (freight) chỉ tính giá thực đã chốt đối soát; duty tính theo actual_duty_vnd
 * của các đơn đã gán vào kê (CEO 21/09/2026, thay luật 08/09).
 * Dùng bởi server action (nút "Tính lại tổng") và script bảo trì. Bảng kê đã
 * issued/paid KHÔNG tính lại — số đã gửi brand phải đứng yên.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { giaThuBangKe, summarizeStatement } from './statement-logic';

export async function tinhLaiTongBangKe(id: string): Promise<{ ok: boolean; error?: string; orderCount: number; totalChargedVnd: number; truoc?: number }> {
  const [st] = await db.select({ status: schema.shipHoStatements.status, type: schema.shipHoStatements.type, total: schema.shipHoStatements.totalChargedVnd })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return { ok: false, error: 'Không tìm thấy bảng kê', orderCount: 0, totalChargedVnd: 0 };
  if (st.status !== 'draft') return { ok: false, error: 'Bảng kê đã gửi/đã thu — không tính lại', orderCount: 0, totalChargedVnd: 0 };
  const tien: number[] = [];
  if (st.type === 'freight') {
    const orders = await db.select({ actualChargedVnd: schema.shipHoOrders.actualChargedVnd, reconcileStatus: schema.shipHoOrders.reconcileStatus })
      .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
    for (const o of orders) { const g = giaThuBangKe(o); if (g != null) tien.push(g); }
  } else {
    const orders = await db.select({ duty: schema.shipHoOrders.actualDutyVnd }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.dutyStatementId, id));
    for (const o of orders) if (o.duty != null) tien.push(Number(o.duty));
  }
  const sums = summarizeStatement(tien);
  await db.update(schema.shipHoStatements).set({ orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd) }).where(eq(schema.shipHoStatements.id, id));
  return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, truoc: Number(st.total) };
}
