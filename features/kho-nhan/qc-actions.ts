'use server';

import { desc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { applyMovement } from '@/features/warehouse/ledger';
import { isStorageConfigured } from '@/lib/storage/s3';
import { requirePerm } from '@/features/receiving/perm';
import { chuyenDuocQc, kiemLoQc, type DongLoiVao } from './qc-logic';
import { danhDauQcDatTrenLark, danhDauQcKhongDatTrenLark } from './day-wh-lark';
import type { DangKiem } from './types';

/**
 * QC ĐẠT → chiếc vào tồn. Đây là chỗ DUY NHẤT trong luồng này gọi `applyMovement`.
 *
 * Khoá dòng `FOR UPDATE` rồi ĐỌC LẠI trạng thái trong transaction: hai người cùng
 * bấm Đạt trên một chiếc thì người sau phải thấy `pass` và dừng, không nhập đôi tồn.
 */
export async function qcDat(itemId: string, kho: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  try {
    await db.transaction(async (tx) => {
      const [it] = await tx.select().from(schema.goodsReceiptItems)
        .where(eq(schema.goodsReceiptItems.id, itemId)).for('update');
      if (!it) throw new Error('Không tìm thấy chiếc hàng.');
      if (!chuyenDuocQc(it.qcResult)) throw new Error('Chiếc này đã QC rồi.');
      if (!it.sku) throw new Error('Chiếc này chưa có SKU, không nhập kho được.');

      // `stockStatus: 'in_stock'` là thứ làm chiếc này CẤP ĐƯỢC cho đơn:
      // `allocate.ts` lọc đúng `stock_status = 'in_stock'` VÀ
      // `current_warehouse_code IS NOT NULL`. Thiếu một trong hai thì hàng QC đạt
      // nằm im vĩnh viễn, không ai bán được, mà không có lỗi nào báo.
      await tx.update(schema.goodsReceiptItems).set({
        qcResult: 'pass', disposition: 'store', currentWarehouseCode: kho,
        stockStatus: 'in_stock',
        qcCheckedBy: actor, qcCheckedAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.goodsReceiptItems.id, itemId));

      await applyMovement(tx, {
        sku: it.sku, warehouseCode: kho, deltaOnHand: 1, deltaReserved: 0,
        reason: 'receipt_consignment', refType: 'receipt_item', refId: itemId,
        actor, createIfMissing: { productTitle: it.productTitle, variantTitle: it.variantTitle },
      });
    });
    // Đổi WH - Action trên Lark sang "Tạm nhập (đi đơn)". NGOÀI transaction và
    // best-effort: Lark hỏng không được làm hỏng việc nhập kho đã xong.
    await danhDauQcDatTrenLark(itemId, actor);
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] qcDat lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'QC thất bại, thử lại.' };
  }
}

/**
 * QC KHÔNG ĐẠT → chiếc sang `return_to_brand`, ghi từng chỗ lỗi.
 * KHÔNG gọi `applyMovement`: hàng lỗi không bao giờ vào tồn.
 */
export async function qcKhongDat(itemId: string, dongLoi: DongLoiVao[]): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  const kiem = kiemLoQc(dongLoi, isStorageConfigured());
  if (!kiem.ok) return { ok: false, loi: kiem.loi };
  try {
    await db.transaction(async (tx) => {
      const [it] = await tx.select().from(schema.goodsReceiptItems)
        .where(eq(schema.goodsReceiptItems.id, itemId)).for('update');
      if (!it) throw new Error('Không tìm thấy chiếc hàng.');
      if (!chuyenDuocQc(it.qcResult)) throw new Error('Chiếc này đã QC rồi.');

      // `qc_failed` giữ chiếc NGOÀI tầm mắt phân bổ, và `current_warehouse_code`
      // vẫn NULL — hàng lỗi không bao giờ vào tồn, không bao giờ bán được.
      await tx.update(schema.goodsReceiptItems).set({
        qcResult: 'fail', disposition: 'return_to_brand',
        stockStatus: 'qc_failed',
        qcCheckedBy: actor, qcCheckedAt: new Date(), updatedAt: new Date(),
      }).where(eq(schema.goodsReceiptItems.id, itemId));

      await tx.insert(schema.whLoiQc).values(dongLoi.map((d) => ({
        receiptItemId: itemId, lyDo: d.lyDo,
        anhKey: d.anhKey, ghiChu: d.ghiChu.trim() || null, taoBoi: actor,
      })));
    });
    // Sau khi ghi xong bên mình: báo Lark. Trước đây luồng hỏng không báo gì,
    // chiếc trượt QC nằm im ở " Chờ QC " và không bộ phận nào biết.
    await danhDauQcKhongDatTrenLark(itemId, actor);
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] qcKhongDat lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Ghi lỗi thất bại, thử lại.' };
  }
}


/** Chiếc đang chờ kiểm — mới nhất trước. Chỉ `pending`. */
export async function danhSachDangKiem(): Promise<DangKiem[]> {
  await requirePerm('view_receiving');
  return db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    shopifyVariantId: schema.goodsReceiptItems.shopifyVariantId,
    larkRecordId: schema.goodsReceiptItems.larkRecordId,
    tenSanPham: schema.goodsReceiptItems.productTitle,
    tenBienThe: schema.goodsReceiptItems.variantTitle,
    orderId: schema.goodsReceiptItems.orderId,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    storeId: schema.shopifyOrders.storeId,
    shopifyOrderId: schema.shopifyOrders.shopifyOrderId,
    kho: schema.goodsReceipts.warehouseCode,
    receiptId: schema.goodsReceiptItems.receiptId,
    vendor: schema.goodsReceipts.vendor,
    taoLuc: schema.goodsReceiptItems.createdAt,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(eq(schema.goodsReceiptItems.qcResult, 'pending'))
    .orderBy(desc(schema.goodsReceiptItems.createdAt))
    .limit(200);
}
