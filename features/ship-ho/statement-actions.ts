'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { summarizeStatement, giaThuBangKe } from './statement-logic';
import type { LoaiBangKe } from './statement-logic';
import { donVaoKe, tinhLaiTongBangKe, donLechKy } from './statement-core';
import { getShipHoStatement } from './statement-queries';
import { payloadStatementIssued, pushStatementEvent } from './statement-push';
import { khoanPhiChoBangKe } from './bang-ke-khoan-phi-queries';
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

  const { don, choHoaDon } = await donVaoKe(partnerBrandSlug, type, periodStart, periodEnd);
  const ids = don.map((d) => d.id);
  const sums = summarizeStatement(don.map((d) => d.tien));
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
    /* Phép chiếu chéo mục (e) — CHẶN, không cảnh báo suông (CEO 01/10/2026, thống nhất với MMP).
     * Phát hành một kỳ có đơn lệch mốc là gửi brand một con số mà bên MMP tính ra kỳ khác, rồi
     * phải xuất hoá đơn điều chỉnh cho một chuyện lẽ ra chặn được trước khi bấm. */
    const lech = await donLechKy(id);
    if (lech.length > 0) {
      return { ok: false, error: `Bảng kê có ${lech.length} đơn mốc kỳ nằm ngoài kỳ này: ${lech.slice(0, 8).join(', ')}${lech.length > 8 ? '…' : ''} — chạy lại lệnh gom để xếp đúng kỳ trước khi phát hành` };
    }
    await db.update(schema.shipHoStatements).set({ status: 'issued', issuedAt: new Date() }).where(eq(schema.shipHoStatements.id, id));
    const data = await getShipHoStatement(id);
    if (data) {
      const dong: DongBangKeMmp[] = [];
      /* Nạp khoản phí CẢ LÔ một lượt trước vòng lặp — hỏi từng đơn là một lượt đi CSDL mỗi dòng. */
      const phi = await khoanPhiChoBangKe(data.orders.map((x) => (x as { code: string }).code), data.statement.type);
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
          ...(phi.get(r.code) ?? {}),
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
