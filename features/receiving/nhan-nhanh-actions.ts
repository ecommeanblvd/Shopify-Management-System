'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { recomputeRollup } from '@/features/fulfillment/rollup';
import { recordAudit } from '@/lib/logging/audit';
import { requirePerm, withUniqueRetry } from './perm';
import { taoMonTrongTx } from './tao-mon';
import { createReceipt } from './actions';
import { docMaTem } from './ma-tem';
import { soTemDuocIn, phanLoaiQuet, duChiec, type LyDoTuChoi } from './nhan-nhanh-logic';
import { ghiNhanHangTrongTx } from './ghi-nhan-hang';
import {
  listBrandDangCho, listDongCho, getDongTheoShopifyLineId, getDongTheoId, getPhieuHomNay,
  getMonTheoUnitCode, listMonTrongPhieu, type BrandDangCho, type DongCho,
} from './nhan-nhanh-queries';
import { batDayNhanHang } from '@/features/lark/nhan-hang-backfill';
import { dongBoNhanHangLark } from '@/features/lark/push-nhan-hang';
import { listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields } from '@/features/lark/client';

export async function layBrandDangCho(): Promise<BrandDangCho[]> {
  await requirePerm('view_receiving');
  return listBrandDangCho();
}

export async function layDongCho(brandSlug: string): Promise<DongCho[]> {
  await requirePerm('view_receiving');
  return listDongCho(brandSlug);
}

/** Quét tem brand `L:<id>` ở bước 2 → dòng đơn. Quét tem món ở đây là nhầm chỗ. */
export async function layDongTheoMaQuet(maQuet: string): Promise<{ ok: true; dong: DongCho } | { ok: false; loi: string }> {
  await requirePerm('view_receiving');
  const ma = docMaTem(maQuet);
  if (!ma) return { ok: false, loi: 'Mã không đúng dạng tem (WH-… hoặc L:…)' };
  if (ma.loai === 'mon') return { ok: false, loi: 'Đây là tem món — quét ở bước xác nhận' };
  const dong = await getDongTheoShopifyLineId(ma.shopifyLineId);
  if (!dong) return { ok: false, loi: `Không có dòng đơn nào mang Line ID ${ma.shopifyLineId}` };
  return { ok: true, dong };
}

/** Một kiện về = một phiếu: mở phiếu retail_for_order hôm nay của brand, chưa có thì tạo. */
export async function moPhieuBrand(brandSlug: string): Promise<{ id: string; code: string }> {
  await requirePerm('manage_receiving');
  const co = await getPhieuHomNay(brandSlug);
  if (co) return co;
  const id = await createReceipt({ sourceType: 'retail_for_order', vendor: brandSlug, note: 'Nhập kho quét mã' });
  const [row] = await db.select({ code: schema.goodsReceipts.code }).from(schema.goodsReceipts).where(eq(schema.goodsReceipts.id, id)).limit(1);
  return { id, code: row.code };
}

/** Bấm "In N tem": tạo N món (đã in, chưa xác nhận). Phần vượt mong đợi → ngoài kế hoạch (spec §3.1). */
export async function inTemMon(i: { receiptId: string; lineId: string; soLuong: number }): Promise<{ maTheoDon: string[]; maNgoaiKeHoach: string[] }> {
  const userId = await requirePerm('manage_receiving');
  const dong = await getDongTheoId(i.lineId);
  if (!dong) throw new Error('Dòng đơn không tồn tại');
  const { theoDon, ngoaiKeHoach } = soTemDuocIn({ mongDoi: dong.mongDoi, daIn: dong.daIn, daXacNhan: dong.daXacNhan }, i.soLuong);
  const maTheoDon: string[] = []; const maNgoaiKeHoach: string[] = [];
  const chung = { receiptId: i.receiptId, sku: dong.sku, productTitle: dong.productTitle, variantTitle: dong.variantTitle, printedAt: 'now' as const };
  for (let k = 0; k < theoDon; k++) {
    const { unitCode } = await withUniqueRetry(() => db.transaction((tx) => taoMonTrongTx(tx, {
      ...chung, brandRequestId: dong.brandRequestId, fulfillmentLineId: dong.lineId, orderId: dong.orderId,
    })));
    maTheoDon.push(unitCode);
  }
  for (let k = 0; k < ngoaiKeHoach; k++) {
    const { unitCode } = await withUniqueRetry(() => db.transaction((tx) => taoMonTrongTx(tx, { ...chung, unplanned: true })));
    maNgoaiKeHoach.push(unitCode);
  }
  try { await recordAudit({ userId, action: 'receiving_print_labels', target: i.receiptId, requestSummary: `${dong.orderNumber ?? ''} ${dong.sku ?? ''} ×${theoDon}+${ngoaiKeHoach}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${i.receiptId}`);
  return { maTheoDon, maNgoaiKeHoach };
}

/** Hàng không có trong danh sách chờ: in tem, cờ vàng, không nối dòng đơn. */
export async function nhanNgoaiKeHoach(i: { receiptId: string; sku: string | null; productTitle: string | null; soLuong: number }): Promise<{ ma: string[] }> {
  const userId = await requirePerm('manage_receiving');
  const n = Math.max(0, Math.min(50, Math.floor(i.soLuong)));
  const ma: string[] = [];
  for (let k = 0; k < n; k++) {
    const { unitCode } = await withUniqueRetry(() => db.transaction((tx) => taoMonTrongTx(tx, {
      receiptId: i.receiptId, sku: i.sku, productTitle: i.productTitle, printedAt: 'now', unplanned: true,
    })));
    ma.push(unitCode);
  }
  try { await recordAudit({ userId, action: 'receiving_unplanned', target: i.receiptId, requestSummary: `${i.sku ?? i.productTitle ?? '?'} ×${n}`, result: 'success' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${i.receiptId}`);
  return { ma };
}

export type KetQuaQuet =
  | { ok: true; unitCode: string; lineId: string | null; daXacNhan: number; mongDoi: number; duChiec: boolean }
  | { ok: false; lyDo: LyDoTuChoi };

/**
 * Quét xác nhận tem đã dán. Chỉ ghi khi 'khop'. Đủ chiếc → delivered_at, dòng
 * brand_confirmed → in_stock, ngày nhận cho MMP, đẩy Lark (best-effort).
 */
export async function xacNhanQuet(i: { receiptId: string; maQuet: string }): Promise<KetQuaQuet> {
  const userId = await requirePerm('manage_receiving');
  const ma = docMaTem(i.maQuet);
  if (!ma || ma.loai !== 'mon') return { ok: false, lyDo: 'khong_phai_tem_mon' };
  const mon = await getMonTheoUnitCode(ma.unitCode);
  const pl = phanLoaiQuet(mon, i.receiptId);
  if (pl !== 'khop' || !mon) return { ok: false, lyDo: pl === 'khop' ? 'khong_ton_tai' : pl };

  const kq = await db.transaction(async (tx) => {
    // Idempotent: hai người quét cùng tem thì chỉ một người ghi được.
    const up = await tx.update(schema.goodsReceiptItems).set({ confirmedAt: sql`now()` })
      .where(and(eq(schema.goodsReceiptItems.id, mon.id), isNull(schema.goodsReceiptItems.confirmedAt)))
      .returning({ id: schema.goodsReceiptItems.id });
    if (up.length === 0) return { ok: false as const, lyDo: 'da_xac_nhan' as const };
    if (!mon.fulfillmentLineId) return { ok: true as const, unitCode: ma.unitCode, lineId: null, daXacNhan: 0, mongDoi: 0, duChiec: false, chot: null };

    const [line] = await tx.select({
      id: schema.orderFulfillmentLines.id, fulfillmentId: schema.orderFulfillmentLines.fulfillmentId,
      status: schema.orderFulfillmentLines.status, qty: schema.orderFulfillmentLines.qty, sku: schema.orderFulfillmentLines.sku,
    }).from(schema.orderFulfillmentLines).where(eq(schema.orderFulfillmentLines.id, mon.fulfillmentLineId)).limit(1);
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, line.id), sql`${schema.goodsReceiptItems.confirmedAt} is not null`));
    const dem = { mongDoi: line.qty, daIn: 0, daXacNhan: n };
    if (!duChiec(dem)) return { ok: true as const, unitCode: ma.unitCode, lineId: line.id, daXacNhan: n, mongDoi: line.qty, duChiec: false, chot: null };

    // ĐỦ CHIẾC → chốt (spec §3 bước 4, §5.1).
    if (line.status === 'brand_confirmed') {
      await tx.update(schema.orderFulfillmentLines).set({ status: 'in_stock', allocatedQty: 0, updatedAt: sql`now()` })
        .where(eq(schema.orderFulfillmentLines.id, line.id));
      await tx.insert(schema.orderFulfillmentEvents).values({
        fulfillmentId: line.fulfillmentId, lineId: line.id, fromStatus: 'brand_confirmed', toStatus: 'in_stock',
        actor: userId, note: `Nhận hàng quét mã, đủ ${n}/${line.qty}`,
      });
      await recomputeRollup(tx, line.fulfillmentId);
    }
    await tx.update(schema.brandOrderRequests).set({ deliveredAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(schema.brandOrderRequests.fulfillmentLineId, line.id), isNull(schema.brandOrderRequests.deliveredAt)));
    const [ctx] = await tx.select({
      orderNumber: schema.shopifyOrders.shopifyOrderNumber, vendor: schema.brandOrderRequests.brandSlug,
    }).from(schema.brandOrderRequests)
      .innerJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.brandOrderRequests.orderId))
      .where(eq(schema.brandOrderRequests.fulfillmentLineId, line.id)).limit(1);
    if (ctx?.orderNumber && line.sku) await ghiNhanHangTrongTx(tx, { orderNumber: ctx.orderNumber, sku: line.sku, vendor: ctx.vendor });
    const maMon = await tx.select({ unitCode: schema.goodsReceiptItems.unitCode }).from(schema.goodsReceiptItems)
      .where(and(eq(schema.goodsReceiptItems.fulfillmentLineId, line.id), sql`${schema.goodsReceiptItems.confirmedAt} is not null`))
      .orderBy(schema.goodsReceiptItems.unitCode);
    return {
      ok: true as const, unitCode: ma.unitCode, lineId: line.id, daXacNhan: n, mongDoi: line.qty, duChiec: true,
      chot: ctx?.orderNumber && line.sku ? { orderNumber: ctx.orderNumber, sku: line.sku, vendor: ctx.vendor, maMon: maMon.map((m) => m.unitCode) } : null,
    };
  });

  if (kq.ok && kq.chot && batDayNhanHang()) {
    // Best-effort: Lark hỏng không chặn — cron push-nhan-hang điền bù theo lark_pushed_at.
    try {
      const r = await dongBoNhanHangLark([{ ...kq.chot, receivedAt: new Date() }], listBrandReceivedRecords, createBrandReceivedRecord, updateBrandReceivedRecordFields);
      if (r.loi.length === 0) {
        await db.update(schema.mmpLineReceived).set({ larkPushedAt: sql`now()` })
          .where(and(eq(schema.mmpLineReceived.orderNumber, kq.chot.orderNumber.replace(/^#/, '')), eq(schema.mmpLineReceived.sku, kq.chot.sku)));
      }
    } catch (e) { console.error('[nhan-hang] lark push failed', e); }
  }
  try { await recordAudit({ userId, action: 'receiving_confirm_scan', target: i.receiptId, requestSummary: ma.unitCode, result: kq.ok ? 'success' : 'error' }); } catch (e) { console.error('audit failed', e); }
  revalidatePath(`/f/warehouse/receiving/${i.receiptId}`);
  revalidatePath('/f/warehouse/receiving');
  if (!kq.ok) return kq;
  const { chot: _chot, ...ra } = kq;
  return ra;
}

export async function layMonTrongPhieu(receiptId: string) {
  await requirePerm('view_receiving');
  return listMonTrongPhieu(receiptId);
}
