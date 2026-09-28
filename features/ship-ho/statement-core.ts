/**
 * Lõi không-auth cho bảng kê ship hộ: tính lại tổng một bảng kê còn NHÁP theo LOẠI —
 * cước (freight) chỉ tính giá thực đã chốt đối soát; duty tính theo actual_duty_vnd
 * của các đơn đã gán vào kê (CEO 21/09/2026, thay luật 08/09).
 * Dùng bởi server action (nút "Tính lại tổng") và script bảo trì. Bảng kê đã
 * issued/paid KHÔNG tính lại — số đã gửi brand phải đứng yên.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { sql } from 'drizzle-orm';
import { chiaDonTrongKe, summarizeStatement, QUYET_DINH_DA_CHOT } from './statement-logic';
import type { LoaiBangKe } from './statement-logic';
import { kyThang, viecGom } from './ky-bang-ke';

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

/**
 * Lõi KHÔNG-AUTH: gom đơn đủ điều kiện vào một kỳ. Dùng chung bởi server action
 * `generateStatement` (nút bấm tay) và lệnh tự động — một nguồn sự thật duy nhất
 * cho điều kiện "được vào bảng kê" (D-125).
 *
 * MỐC KỲ = ngày LẦN PUSH ĐẦU TIÊN thành công của `order.reconciled` sang MMP
 * (CEO 22/09/2026): MMP chốt kỳ theo đơn Đức đã đối soát và đẩy sang họ; bản đối
 * soát của SMS phải khớp từng dòng nên dùng cùng mốc. Lấy lần ĐẦU (không phải lần
 * gần nhất) để bắn lại khi tách duty không kéo đơn kỳ đã khoá sang kỳ mới.
 */
export async function donVaoKe(
  partnerBrandSlug: string, type: LoaiBangKe, periodStart: string, periodEnd: string,
): Promise<{ ids: string[]; tien: number[]; choHoaDon: number }> {
  const ids: string[] = []; const tien: number[] = []; let choHoaDon = 0;
  if (type === 'freight') {
    const rows = await db.execute<{ id: string; gia: string | null; cho: boolean }>(sql`
      SELECT o.id,
             CASE WHEN o.reconcile_status = 'reconciled'
                   AND (o.reconcile_decision IS NULL OR o.reconcile_decision IN ${QUYET_DINH_DA_CHOT})
                   AND p.push_dau IS NOT NULL AND p.push_dau::date BETWEEN ${periodStart} AND ${periodEnd}
                  THEN o.actual_charged_vnd END AS gia,
             ((o.actual_charged_vnd IS NULL OR o.reconcile_status IS DISTINCT FROM 'reconciled'
               OR (o.reconcile_decision IS NOT NULL AND o.reconcile_decision NOT IN ${QUYET_DINH_DA_CHOT}))
              AND o.shipped_at BETWEEN ${periodStart} AND ${periodEnd}) AS cho
        FROM ship_ho_orders o
        LEFT JOIN LATERAL (
          SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
           WHERE e.order_id = o.id AND e.event = 'order.reconciled' AND e.delivery_status = 'delivered'
        ) p ON TRUE
       WHERE o.partner_brand_slug = ${partnerBrandSlug} AND o.statement_id IS NULL
         AND o.status IN ('shipped','delivered')
         AND NOT (COALESCE(o.ly_do_cham,'') = 'khong_gui_hang' AND COALESCE(o.ly_do_doi_chieu,'') = 'xac_nhan')`);
    for (const r of rows.rows) {
      if (r.gia != null) { ids.push(r.id); tien.push(Number(r.gia)); }
      else if (r.cho) choHoaDon++;
    }
  } else {
    const rows = await db.execute<{ id: string; gia: string }>(sql`
      SELECT o.id, o.actual_duty_vnd AS gia
        FROM ship_ho_orders o
        LEFT JOIN LATERAL (
          SELECT min(e.occurred_at) AS push_dau FROM ship_ho_order_events e
           WHERE e.order_id = o.id AND e.event = 'order.duty_charged' AND e.delivery_status = 'delivered'
        ) p ON TRUE
       WHERE o.partner_brand_slug = ${partnerBrandSlug} AND o.duty_statement_id IS NULL AND o.actual_duty_vnd > 0
         AND p.push_dau IS NOT NULL AND p.push_dau::date BETWEEN ${periodStart} AND ${periodEnd}`);
    for (const r of rows.rows) { ids.push(r.id); tien.push(Number(r.gia)); }
  }
  return { ids, tien, choHoaDon };
}

/** Mốc quá khứ đủ xa để cửa sổ gom không bỏ sót đơn kỳ cũ chưa kê. */
const MOC_XA = '2000-01-01';

export interface KetQuaGom { brand: string; type: LoaiBangKe; viec: string; don: number; tien: number; statementId?: string }

/**
 * Lệnh TỰ ĐỘNG: gom đơn đã chốt giá vào bảng kê NHÁP của kỳ đang chạy, cho mọi
 * brand. KHÔNG tự phát hành — chốt kỳ là việc kế toán, người bấm (CEO 28/09/2026).
 *
 * Idempotent: kỳ đã có bản nháp thì gom THÊM vào đúng bản đó rồi tính lại tổng,
 * không đẻ bản thứ hai. Kỳ đã `issued`/`paid` thì bỏ qua — số đã gửi brand phải
 * đứng yên, đơn về muộn sang kỳ sau.
 */
export async function goBangKeNhap(now: Date = new Date()): Promise<KetQuaGom[]> {
  const ky = kyThang(now);
  const brands = await db.selectDistinct({ slug: schema.shipHoOrders.partnerBrandSlug })
    .from(schema.shipHoOrders);
  const ket: KetQuaGom[] = [];

  for (const { slug } of brands) {
    for (const type of ['freight', 'duty'] as const) {
      /* Cửa sổ gom MỞ VỀ QUÁ KHỨ, không bó trong tháng đang chạy.
       *
       * Nếu chỉ lấy đơn đẩy trong tháng này thì đơn đẩy ở một kỳ ĐÃ CHỐT nhưng
       * chưa kịp vào kê sẽ không bao giờ được gom nữa: kỳ cũ khoá rồi, kỳ mới
       * không nhận. Đo 28/09: Kalisa có đúng một đơn như vậy, 3.333.719đ đẩy
       * tháng 8. Đây là họ lỗi D-130 — hàng chờ không có lối ra.
       *
       * CEO 28/09 chốt: mọi đơn đã chốt giá mà chưa kê đều vào KỲ ĐANG MỞ. Bảng
       * kê vẫn mang kỳ của tháng này; chỉ cửa sổ NHẶT đơn là mở về trước. */
      const { ids, tien } = await donVaoKe(slug, type, MOC_XA, ky.cuoi);
      if (ids.length === 0) continue;

      const [daCo] = await db.select({ id: schema.shipHoStatements.id, status: schema.shipHoStatements.status })
        .from(schema.shipHoStatements)
        .where(and(
          eq(schema.shipHoStatements.partnerBrandSlug, slug),
          eq(schema.shipHoStatements.periodStart, ky.dau),
          eq(schema.shipHoStatements.type, type),
        )).limit(1);

      const viec = viecGom(daCo?.status);
      if (viec === 'bo_qua_da_chot') {
        ket.push({ brand: slug, type, viec, don: ids.length, tien: 0 });
        continue;
      }

      const sums = summarizeStatement(tien);
      let id = daCo?.id;
      if (!id) {
        const [st] = await db.insert(schema.shipHoStatements).values({
          partnerBrandSlug: slug, type, periodStart: ky.dau, periodEnd: ky.cuoi,
          orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd), status: 'draft',
        }).returning({ id: schema.shipHoStatements.id });
        id = st!.id;
      }
      await db.update(schema.shipHoOrders)
        .set(type === 'freight' ? { statementId: id, status: 'billed' } : { dutyStatementId: id })
        .where(inArray(schema.shipHoOrders.id, ids));
      // Tính lại từ CHÍNH các đơn đã gán — không cộng dồn con số cũ.
      const lai = await tinhLaiTongBangKe(id);
      ket.push({ brand: slug, type, viec, don: lai.orderCount, tien: lai.totalChargedVnd, statementId: id });
    }
  }
  return ket;
}
