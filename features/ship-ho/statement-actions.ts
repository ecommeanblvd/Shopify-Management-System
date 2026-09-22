'use server';

import { eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { summarizeStatement, QUYET_DINH_DA_CHOT, giaThuBangKe } from './statement-logic';
import type { LoaiBangKe } from './statement-logic';
import { tinhLaiTongBangKe } from './statement-core';
import { getShipHoStatement } from './statement-queries';
import { payloadStatementIssued, pushStatementEvent } from './statement-push';
import type { DongBangKeMmp } from './statement-push';

/** Gom đơn theo LOẠI bảng kê: cước (freight, kỳ theo ngày gửi, chỉ đơn đã chốt đối
 *  soát) hoặc duty (kỳ theo ngày hoá đơn FedEx). CEO 21/09/2026. */
export async function generateStatement(
  partnerBrandSlug: string, type: LoaiBangKe, periodStart: string, periodEnd: string, opts?: { dryRun?: boolean },
): Promise<{ ok: boolean; error?: string; statementId?: string; orderCount: number; totalChargedVnd: number; dryRun: boolean; choHoaDon: number }> {
  const dryRun = opts?.dryRun ?? false;
  const rong = { orderCount: 0, totalChargedVnd: 0, dryRun, choHoaDon: 0 };
  try { await requireManageShipHo(); } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e), ...rong }; }
  if (!partnerBrandSlug) return { ok: false, error: 'Thiếu partner', ...rong };
  if (!periodStart || !periodEnd) return { ok: false, error: 'Thiếu kỳ', ...rong };

  const ids: string[] = []; const tien: number[] = []; let choHoaDon = 0;
  if (type === 'freight') {
    // MỐC KỲ = ngày LẦN PUSH ĐẦU TIÊN thành công của `order.reconciled` sang MMP (CEO 22/09/2026):
    // MMP chốt kỳ theo đơn Đức đã đối soát và đẩy sang họ; bản đối soát của SMS phải khớp từng
    // dòng nên dùng cùng mốc. Lấy lần ĐẦU (không phải lần gần nhất) để bắn lại khi tách duty
    // không kéo đơn kỳ 07/08 đã khoá sang kỳ mới. Ngày gửi / ngày bill / ngày Đức chốt chỉ dùng
    // cho báo cáo nội bộ. Điều kiện vào kê không đổi: đã đối soát và Đức đã chốt.
    // cho (chờ hoá đơn) = đơn GỬI trong kỳ mà chưa có giá thực dùng được — chưa reconciled, giá
    // null (re-quote lỗi), hay còn chờ Đức duyệt/claim — hiển thị để Ops biết còn gì treo.
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
    // MỐC KỲ DUTY = ngày lần push đầu tiên thành công của `order.duty_charged` (CEO 22/09/2026) —
    // trước khi bật MMP_TACH_DUTY chưa có sự kiện nào nên bảng kê duty rỗng; đúng ý: MMP là nơi
    // phát hành, chưa nhận duty thì chưa có kỳ để đối soát.
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
  const sums = summarizeStatement(tien);
  if (dryRun || ids.length === 0) return { ok: true, ...sums, dryRun, choHoaDon };

  const [st] = await db.insert(schema.shipHoStatements).values({
    partnerBrandSlug, type, periodStart, periodEnd, orderCount: sums.orderCount, totalChargedVnd: String(sums.totalChargedVnd), status: 'draft',
  }).returning({ id: schema.shipHoStatements.id });
  if (type === 'freight') {
    await db.update(schema.shipHoOrders).set({ statementId: st.id, status: 'billed' }).where(inArray(schema.shipHoOrders.id, ids));
  } else {
    await db.update(schema.shipHoOrders).set({ dutyStatementId: st.id }).where(inArray(schema.shipHoOrders.id, ids));
  }
  revalidatePath('/f/ship-ho/statements');
  return { ok: true, statementId: st.id, ...sums, dryRun, choHoaDon };
}

/** Tính lại tổng bảng kê NHÁP theo giá thực của các đơn đã có bill (bill về sau khi tạo kê). */
export async function recomputeDraftStatement(id: string): Promise<{ ok: boolean; error?: string; orderCount: number; totalChargedVnd: number; truoc?: number; daGo?: number; daGoMa?: string[] }> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), orderCount: 0, totalChargedVnd: 0 };
  }
  const r = await tinhLaiTongBangKe(id);
  if (r.ok) revalidatePath('/f/ship-ho/statements');
  return r;
}

/** issued: đánh dấu đã gửi partner + bắn `statement.issued` (bản đối soát) cho MMP.
 *  paid: đã thu + bắn `statement.paid`; loại freight đơn trong kê chuyển 'settled', loại duty không đổi status đơn.
 *  Push MMP best-effort — lỗi không chặn đổi trạng thái (CEO 21/09/2026) NHƯNG trả kết quả
 *  `mmp` (ok + detail) để UI nói rõ MMP có nhận hay không, thay vì im lặng. */
export async function setStatementStatus(
  id: string,
  status: 'issued' | 'paid',
): Promise<{ ok: boolean; error?: string; mmp?: { ok: boolean; detail: string } }> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let mmp: { ok: boolean; detail: string } | undefined;
  if (status === 'issued') {
    // Đã phát hành rồi thì KHÔNG đổi trạng thái và KHÔNG bắn lại: bản đối soát gửi hai
    // lần làm MMP thấy hai ảnh chụp khác nhau của cùng bảng kê (issuedAt bị dời).
    const [ht] = await db.select({ status: schema.shipHoStatements.status, type: schema.shipHoStatements.type })
      .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
    if (!ht) return { ok: false, error: 'Không tìm thấy bảng kê' };
    if (ht.status === 'issued') return { ok: false, error: 'Bảng kê đã phát hành — không gửi lại' };
    // Chặn phát hành kê còn đơn CHƯA CHỐT được giá (N2, review 21/09/2026): đơn có
    // thể rơi về 'pending_review'/'claiming' hoặc mất actual_charged_vnd SAU khi đã
    // gán vào kê mà operator quên bấm "Tính lại" — phát hành lúc đó gửi thiếu tiền
    // (đơn không có trong payload MMP — xem vòng lặp bên dưới) mà bảng kê vẫn coi
    // như đã gửi đủ.
    if (ht.type === 'freight') {
      const dangKe = await db.select({
        actualChargedVnd: schema.shipHoOrders.actualChargedVnd,
        reconcileStatus: schema.shipHoOrders.reconcileStatus,
        reconcileDecision: schema.shipHoOrders.reconcileDecision,
      }).from(schema.shipHoOrders).where(eq(schema.shipHoOrders.statementId, id));
      const chuaChot = dangKe.filter((o) => giaThuBangKe(o) == null).length;
      if (chuaChot > 0) return { ok: false, error: `Bảng kê còn ${chuaChot} đơn chưa chốt — bấm Tính lại trước` };
    }
    await db.update(schema.shipHoStatements).set({ status: 'issued', issuedAt: new Date() }).where(eq(schema.shipHoStatements.id, id));
    const data = await getShipHoStatement(id);
    if (data) {
      const dong: DongBangKeMmp[] = [];
      for (const o of data.orders) {
        const r = o as { code: string; mmpRef: string | null; brandReference: string | null; trackingNumber: string | null; shippedAt: string | null; giaThuVnd: number | null; billNumber?: string | null; issueDate?: string | null };
        // Đơn đã vào kê (statementId/dutyStatementId gán ở generateStatement) LẼ RA luôn có giaThuVnd
        // — null ở đây là bất thường (dữ liệu đổi giữa lúc gom kê và lúc gửi); bỏ khỏi payload MMP
        // thay vì báo lệch giả bằng 0, chỉ log cảnh báo.
        if (r.giaThuVnd == null) {
          console.warn(`[statement-push] bỏ đơn ${r.code} khỏi statement.issued ${id}: giaThuVnd null`);
          continue;
        }
        dong.push({
          code: r.code, mmpRef: r.mmpRef, brandReference: r.brandReference, trackingNumber: r.trackingNumber,
          shippedAt: r.shippedAt, amountVnd: r.giaThuVnd,
          ...(data.statement.type === 'duty' ? { fedexInvoiceNumber: r.billNumber ?? null, invoiceDate: r.issueDate ?? null } : {}),
        });
      }
      mmp = await pushStatementEvent('statement.issued', data.statement.partnerBrandSlug, payloadStatementIssued(data.statement, dong));
    }
  } else {
    const [st] = await db.select({ type: schema.shipHoStatements.type, partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug })
      .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
    const paidAt = new Date();
    await db.update(schema.shipHoStatements).set({ status: 'paid', paidAt }).where(eq(schema.shipHoStatements.id, id));
    if (st?.type === 'freight') {
      await db.update(schema.shipHoOrders).set({ status: 'settled' }).where(eq(schema.shipHoOrders.statementId, id));
    }
    if (st) {
      mmp = await pushStatementEvent('statement.paid', st.partnerBrandSlug, { statementId: id, type: st.type, paidAt: paidAt.toISOString() });
    }
  }
  revalidatePath('/f/ship-ho/statements');
  return { ok: true, mmp };
}
