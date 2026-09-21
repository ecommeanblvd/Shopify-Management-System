/**
 * Lõi không-auth cho bảng kê ship hộ: tính lại tổng một bảng kê còn NHÁP theo LOẠI —
 * cước (freight) chỉ tính giá thực đã chốt đối soát; duty tính theo actual_duty_vnd
 * của các đơn đã gán vào kê (CEO 21/09/2026, thay luật 08/09).
 * Dùng bởi server action (nút "Tính lại tổng") và script bảo trì. Bảng kê đã
 * issued/paid KHÔNG tính lại — số đã gửi brand phải đứng yên.
 */
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { chiaDonTrongKe, summarizeStatement } from './statement-logic';

export async function tinhLaiTongBangKe(id: string): Promise<{
  ok: boolean; error?: string; orderCount: number; totalChargedVnd: number; truoc?: number;
  /** Số đơn bị GỠ khỏi kê draft vì chưa chốt được giá (N2, review 21/09/2026) — id vẫn còn
   *  ở đơn (statement_id gỡ về null) nhưng không góp vào tổng, để kỳ sau nhặt lại được. */
  daGo?: number;
  daGoMa?: string[];
}> {
  const [st] = await db.select({ status: schema.shipHoStatements.status, type: schema.shipHoStatements.type, total: schema.shipHoStatements.totalChargedVnd })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return { ok: false, error: 'Không tìm thấy bảng kê', orderCount: 0, totalChargedVnd: 0 };
  if (st.status !== 'draft') return { ok: false, error: 'Bảng kê đã gửi/đã thu — không tính lại', orderCount: 0, totalChargedVnd: 0 };
  const tien: number[] = [];
  let daGo = 0;
  let daGoMa: string[] = [];
  if (st.type === 'freight') {
    const orders = await db.select({
      id: schema.shipHoOrders.id,
      code: schema.shipHoOrders.code,
      status: schema.shipHoOrders.status,
      actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
      reconcileStatus: schema.shipHoOrders.reconcileStatus,
      // Đơn còn 'pending_review'/'claiming' không được tính vào tổng (spec §2.2).
      reconcileDecision: schema.shipHoOrders.reconcileDecision,
    })
      .from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
    const { thu, go } = chiaDonTrongKe(orders);
    tien.push(...thu);
    if (go.length > 0) {
      // Gỡ hẳn khỏi kê draft (statement_id = NULL) — nếu không, đơn kẹt trong kê này
      // mãi mãi (không tính vào tổng NHƯNG cũng không kỳ nào của generateStatement
      // nhặt lại được, vì statement_id vẫn khác null). status='billed' (đã gán vào
      // kê ở generateStatement) lùi về 'shipped' để đơn hiện lại đúng chỗ; các
      // status khác (shipped/delivered/settled — hiếm khi rơi vào đây) giữ nguyên.
      const goSet = new Set(go);
      const goBilledIds = orders.filter((o) => goSet.has(o.id) && o.status === 'billed').map((o) => o.id);
      await db.update(schema.shipHoOrders).set({ statementId: null }).where(inArray(schema.shipHoOrders.id, go));
      if (goBilledIds.length > 0) {
        await db.update(schema.shipHoOrders).set({ status: 'shipped' }).where(inArray(schema.shipHoOrders.id, goBilledIds));
      }
      daGo = go.length;
      daGoMa = orders.filter((o) => goSet.has(o.id)).map((o) => o.code);
    }
  } else {
    const orders = await db.select({ duty: schema.shipHoOrders.actualDutyVnd }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.dutyStatementId, id));
    for (const o of orders) if (o.duty != null) tien.push(Number(o.duty));
  }
  const sums = summarizeStatement(tien);
  await db.update(schema.shipHoStatements).set({ orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd) }).where(eq(schema.shipHoStatements.id, id));
  return { ok: true, orderCount: sums.orderCount, totalChargedVnd: sums.totalChargedVnd, truoc: Number(st.total), daGo, daGoMa };
}
