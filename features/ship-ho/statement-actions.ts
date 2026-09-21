'use server';

import { eq, inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { summarizeStatement, QUYET_DINH_DA_CHOT } from './statement-logic';
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
    // Kỳ theo NGÀY GỬI; vào kê khi Đức đã chốt đối soát. shipped_at ≤ end (không chặn start) để đơn kỳ trước chốt muộn rơi vào kỳ này.
    // cho (chờ hoá đơn) = CHƯA CÓ GIÁ THỰC dùng được — chưa reconciled, HOẶC đã reconciled nhưng
    // actual_charged_vnd vẫn null (re-quote lỗi) — nếu không đơn này biến mất khỏi cả bill lẫn danh
    // sách chờ (Important-2, review 21/09).
    // Đơn lệch tiền còn chờ Đức duyệt ('pending_review'/'claiming') KHÔNG được thu (spec §2.2:
    // chỉ thu số Đức đã chốt) → rơi sang "Chờ hoá đơn"; hai vế `gia`/`cho` là phần bù CHÍNH XÁC
    // của nhau qua cùng một danh sách QUYET_DINH_DA_CHOT nên không đơn nào rơi ra ngoài cả hai.
    const rows = await db.execute<{ id: string; gia: string | null; cho: boolean }>(sql`
      SELECT id,
             CASE WHEN reconcile_status = 'reconciled'
                   AND (reconcile_decision IS NULL OR reconcile_decision IN ${QUYET_DINH_DA_CHOT})
                  THEN actual_charged_vnd END AS gia,
             ((actual_charged_vnd IS NULL OR reconcile_status IS DISTINCT FROM 'reconciled'
               OR (reconcile_decision IS NOT NULL AND reconcile_decision NOT IN ${QUYET_DINH_DA_CHOT}))
              AND shipped_at >= ${periodStart}) AS cho
        FROM ship_ho_orders
       WHERE partner_brand_slug = ${partnerBrandSlug} AND statement_id IS NULL
         AND status IN ('shipped','delivered') AND shipped_at IS NOT NULL AND shipped_at <= ${periodEnd}
         AND NOT (COALESCE(ly_do_cham,'') = 'khong_gui_hang' AND COALESCE(ly_do_doi_chieu,'') = 'xac_nhan')`);
    for (const r of rows.rows) {
      if (r.gia != null) { ids.push(r.id); tien.push(Number(r.gia)); }
      else if (r.cho) choHoaDon++;
    }
  } else {
    // Kỳ theo NGÀY HOÁ ĐƠN FedEx: đơn có dòng duty của hoá đơn trong kỳ, chưa vào kê duty.
    const rows = await db.execute<{ id: string; gia: string }>(sql`
      SELECT o.id, o.actual_duty_vnd AS gia
        FROM ship_ho_orders o
       WHERE o.partner_brand_slug = ${partnerBrandSlug} AND o.duty_statement_id IS NULL AND o.actual_duty_vnd > 0
         AND EXISTS (SELECT 1 FROM carrier_bill_lines l JOIN carrier_bills b ON b.id = l.bill_id
                      WHERE l.tracking_number = o.tracking_number AND l.duty > 0
                        AND COALESCE(b.issue_date, b.period_start) BETWEEN ${periodStart} AND ${periodEnd})`);
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
export async function recomputeDraftStatement(id: string): Promise<{ ok: boolean; error?: string; orderCount: number; totalChargedVnd: number; truoc?: number }> {
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
    const [ht] = await db.select({ status: schema.shipHoStatements.status })
      .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
    if (!ht) return { ok: false, error: 'Không tìm thấy bảng kê' };
    if (ht.status === 'issued') return { ok: false, error: 'Bảng kê đã phát hành — không gửi lại' };
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
