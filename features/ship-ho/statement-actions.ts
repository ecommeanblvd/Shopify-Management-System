'use server';

import { eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requireManageShipHo } from './require-manage';
import { summarizeStatement } from './statement-logic';
import type { LoaiBangKe } from './statement-logic';
import { donVaoKe, tinhLaiTongBangKe, donLechKy, phatHanhBangKe, banBangKeSangMmp } from './statement-core';
import { banSuKienBangKe } from './statement-outbox';

/** Gom đơn theo LOẠI bảng kê. KỲ CỦA CẢ HAI LOẠI = ngày đẩy lần đầu sang MMP
 *  (`order.reconciled` / `order.duty_charged`) — CEO 22/09/2026, nhận lại 01/10 cùng MMP.
 *  Bản cũ ở đây ghi "duty theo ngày hoá đơn FedEx" (spec 21/09) — đã bị thay, xem `donLechKy`. */
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
    // Toàn bộ luật phát hành nằm ở `phatHanhBangKe` (lõi không-auth) — action này chỉ thêm
    // lớp quyền. Một luật tiền có hai bản sao là cách chắc nhất để chúng lệch nhau.
    const r = await phatHanhBangKe(id);
    if (!r.ok) return { ok: false, error: r.error };
    mmp = r.mmp;
  } else {
    const [st] = await db.select({ type: schema.shipHoStatements.type, partnerBrandSlug: schema.shipHoStatements.partnerBrandSlug })
      .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
    const paidAt = new Date();
    await db.update(schema.shipHoStatements).set({ status: 'paid', paidAt }).where(eq(schema.shipHoStatements.id, id));
    if (st?.type === 'freight') {
      await db.update(schema.shipHoOrders).set({ status: 'settled' }).where(eq(schema.shipHoOrders.statementId, id));
    }
    if (st) {
      mmp = await banSuKienBangKe(id, st.partnerBrandSlug, 'statement.paid',
        { statementId: id, type: st.type, paidAt: paidAt.toISOString() });
    }
  }
  revalidatePath('/f/ship-ho/statements');
  return { ok: true, mmp };
}

/**
 * GỬI LẠI bản đối soát của một bảng kê ĐÃ phát hành sang MMP, KHÔNG đổi trạng thái gì.
 *
 * Vì sao cần (đo 01/10/2026): `ship_ho_order_events` có **0 sự kiện `statement.*`** — SMS chưa
 * bao giờ gửi bảng kê nào sang MMP, và sổ `ShipHoSmsStatement` bên họ đang 0 dòng, nên họ không
 * có gì để đối chiếu từng dòng. Ba bảng kê Kalisa thì mang trạng thái `issued` ngay từ lúc
 * `scripts/nhap-bang-ke-mmp.ts` NHẬP chúng từ MMP về, nên `setStatementStatus` chặn luôn
 * ("đã phát hành — không gửi lại"): **lối nhập dữ liệu đã bịt mất lối gửi.** Không có đường này
 * thì ba kỳ đó vĩnh viễn không sang được MMP.
 *
 * KHÔNG đụng `status` và KHÔNG dời `issued_at`: lý do câu chặn kia tồn tại là để MMP không thấy
 * hai ảnh chụp khác nhau của cùng một bảng kê. Gửi lại mà giữ nguyên mốc thì MMP nhận đúng một
 * ảnh chụp, lần sau trùng lần trước — đó mới là thứ phải giữ, không phải việc cấm gửi.
 *
 * KHÔNG chạy phép chiếu chéo như một CHẶN, mà trả về làm THÔNG TIN. Lượt phát hành chặn vì nó
 * tạo một yêu cầu thu tiền MỚI với brand; lượt gửi lại thì nội dung đã chốt và brand đã nhận
 * từ lâu — chặn ở đây chỉ làm chính những bảng kê cần gửi nhất không gửi được. Ví dụ thật: kê
 * duty kỳ 08 có 23 đơn "lệch" vì nó được gán kỳ theo luật trước 22/09 (ngày hoá đơn FedEx);
 * MMP cũng xếp 23 đơn đó ở kỳ 08, nên gửi là ĐÚNG, còn chặn là sai.
 */
export async function guiLaiBangKe(id: string): Promise<{
  ok: boolean; error?: string; mmp?: { ok: boolean; detail: string }; lech?: string[];
}> {
  try {
    await requireManageShipHo();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const [st] = await db.select({ status: schema.shipHoStatements.status })
    .from(schema.shipHoStatements).where(eq(schema.shipHoStatements.id, id)).limit(1);
  if (!st) return { ok: false, error: 'Không tìm thấy bảng kê' };
  if (st.status === 'draft') {
    return { ok: false, error: 'Bảng kê còn NHÁP — bấm Gửi để phát hành, đường này chỉ gửi lại bản đã phát hành' };
  }
  const mmp = await banBangKeSangMmp(id);
  if (!mmp) return { ok: false, error: 'Không đọc được dữ liệu bảng kê' };
  const lech = await donLechKy(id);
  revalidatePath('/f/ship-ho/statements');
  return { ok: true, mmp, lech };
}
