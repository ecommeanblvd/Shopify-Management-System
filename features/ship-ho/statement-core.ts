/**
 * Lõi không-auth cho bảng kê ship hộ: tính lại tổng một bảng kê còn NHÁP theo luật
 * "đơn đã có bill thu theo giá thực, chưa có bill thu giá báo" (CEO 08/09).
 * Dùng bởi server action (nút "Tính lại tổng") và script bảo trì. Bảng kê đã
 * issued/paid KHÔNG tính lại — số đã gửi brand phải đứng yên.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { giaThuBangKe, summarizeStatement } from './statement-logic';

export async function tinhLaiTongBangKe(id: string): Promise<{ ok: boolean; error?: string; orderCount: number; totalChargedVnd: number; truoc?: number }> {
  const [st] = await db.select({ status: schema.shipHoStatements.status, total: schema.shipHoStatements.totalChargedVnd })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return { ok: false, error: 'Không tìm thấy bảng kê', orderCount: 0, totalChargedVnd: 0 };
  if (st.status !== 'draft') return { ok: false, error: 'Bảng kê đã gửi/đã thu — không tính lại', orderCount: 0, totalChargedVnd: 0 };
  const orders = await db.select({
    chargedVnd: schema.shipHoOrders.chargedVnd, actualChargedVnd: schema.shipHoOrders.actualChargedVnd, reconcileStatus: schema.shipHoOrders.reconcileStatus,
  }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
  const sums = summarizeStatement(orders.map((o) => giaThuBangKe(o)).filter((v): v is number => v != null));
  await db.update(schema.shipHoStatements)
    .set({ orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd) })
    .where(eq(schema.shipHoStatements.id, id));
  return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, truoc: Number(st.total) };
}
