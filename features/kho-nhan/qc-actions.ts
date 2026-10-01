'use server';

import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { applyMovement } from '@/features/warehouse/ledger';
import { isStorageConfigured } from '@/lib/storage/s3';
import { requirePerm } from '@/features/receiving/perm';
import { chuyenDuocQc, themDuocLoi, kiemLoQc, type DongLoiVao, type KetQuaQc } from './qc-logic';
import { danhDauQcDatTrenLark, danhDauQcKhongDatTrenLark } from './day-wh-lark';
import type { DangKiem } from './types';
import { docCanNhap } from './can-chiec';
import { MUI_GIO_KINH_DOANH } from '@/lib/timezone';

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
  const kiem = kiemLoQc(dongLoi);
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


/**
 * Thêm dòng lỗi cho chiếc ĐÃ kiểm không đạt — đường BỔ SUNG SAU (CEO 01/10/2026).
 *
 * Vì sao phải là action riêng, không dùng lại `qcKhongDat`: hàm đó chặn `chuyenDuocQc` nên
 * chiếc đã `fail` gọi vào là nhận "Chiếc này đã QC rồi". Và nó phải chặn — nó còn đổi trạng
 * thái, đặt `qcCheckedAt`, báo Lark. Hàm này CHỈ thêm bằng chứng: không đụng một cột nào của
 * `goods_receipt_items`, không báo Lark lần hai.
 *
 * Chỉ nhận chiếc đang `fail`: thêm dòng lỗi cho chiếc `pass` là ghi bằng chứng lỗi vào hàng đã
 * vào tồn — hai sự thật ngược nhau trên cùng một chiếc. Chiếc `pending` thì đi đường
 * `qcKhongDat` để trạng thái và Lark được cập nhật đúng.
 */
export async function themDongLoiQc(itemId: string, dongLoi: DongLoiVao[]): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  const kiem = kiemLoQc(dongLoi);
  if (!kiem.ok) return { ok: false, loi: kiem.loi };
  try {
    const [it] = await db.select({ qcResult: schema.goodsReceiptItems.qcResult })
      .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);
    if (!it) return { ok: false, loi: 'Không tìm thấy chiếc hàng.' };
    const duoc = themDuocLoi(it.qcResult as KetQuaQc);
    if (!duoc.ok) return { ok: false, loi: duoc.loi };
    await db.insert(schema.whLoiQc).values(dongLoi.map((d) => ({
      receiptItemId: itemId, lyDo: d.lyDo,
      anhKey: d.anhKey, ghiChu: d.ghiChu.trim() || null, taoBoi: actor,
    })));
    revalidatePath('/f/warehouse/nhan-kcs');
    return { ok: true };
  } catch (e) {
    console.error('[kho-nhan] themDongLoiQc lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Ghi lỗi thất bại, thử lại.' };
  }
}

/**
 * Chiếc ở bảng "Nhận hôm nay": đang chờ kiểm, CỘNG chiếc đã kiểm KHÔNG ĐẠT trong NGÀY.
 *
 * Vì sao giữ lại chiếc đã fail (CEO 01/10/2026): ảnh lỗi QC thôi bắt buộc lúc kiểm, "có thể bổ
 * sung sau tại bảng Nhận hôm nay". Nếu bảng vẫn chỉ lọc `pending` thì chiếc vừa đánh fail rời
 * bảng NGAY, và không còn chỗ nào để bổ sung ảnh — lời hứa đó rỗng, còn bằng chứng cãi với
 * brand thì mất.
 *
 * Chỉ TRONG NGÀY, không phải mọi chiếc đã fail: bảng tên là "Nhận hôm nay" và phải ngắn để quét
 * mắt được. Hết ngày thì hồ sơ lỗi đã chốt; sửa sau là việc của màn tra cứu, không phải ô nhập
 * nhanh ở đây. Mốc ngày theo giờ kinh doanh VN, không theo UTC — nửa đêm UTC là 7 giờ sáng ở
 * kho, cắt ngày ở đó là xoá nửa ca làm việc khỏi bảng.
 */
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
    canKg: schema.goodsReceiptItems.weightKg,
    qcResult: schema.goodsReceiptItems.qcResult,
    qcLuc: schema.goodsReceiptItems.qcCheckedAt,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(or(
      eq(schema.goodsReceiptItems.qcResult, 'pending'),
      and(
        eq(schema.goodsReceiptItems.qcResult, 'fail'),
        // Đầu ngày theo giờ kinh doanh VN, đổi về UTC để so với cột timestamp.
        gte(schema.goodsReceiptItems.qcCheckedAt,
          sql`(date_trunc('day', now() AT TIME ZONE ${MUI_GIO_KINH_DOANH}) AT TIME ZONE ${MUI_GIO_KINH_DOANH})`),
      ),
    ))
    .orderBy(desc(schema.goodsReceiptItems.createdAt))
    .limit(200);
}

/**
 * Ghi cân cho MỘT chiếc ngay tại bảng "Nhận hôm nay" (CEO 01/10/2026).
 *
 * CEO chốt: cân điền sau khi kiểm, KHÔNG bắt buộc lúc đó, bổ sung được sau ngay ở bảng này.
 *
 * Ghi thẳng vào `goods_receipt_items.weight_kg` — ĐÚNG cột mà lượt đồng bộ Lark dùng, để cân
 * một chiếc chỉ có MỘT chỗ ở. Hôm nay đã sửa nhiều lỗi sinh ra từ việc một đại lượng có hai
 * nơi chứa; không mở thêm một nơi nữa.
 *
 * Để trống là XOÁ cân (xem `docCanNhap`) — người gõ nhầm phải rút lại được.
 */
export async function datCanChiec(id: string, tho: string): Promise<{ ok: boolean; loi?: string }> {
  await requirePerm('manage_qc');
  const kq = docCanNhap(tho);
  if (!kq.ok) return { ok: false, loi: kq.loi };
  const n = await db.update(schema.goodsReceiptItems)
    .set({ weightKg: kq.kg == null ? null : String(kq.kg) })
    .where(eq(schema.goodsReceiptItems.id, id))
    .returning({ id: schema.goodsReceiptItems.id });
  if (n.length === 0) return { ok: false, loi: 'Không tìm thấy chiếc này' };
  revalidatePath('/f/warehouse/nhan-kcs');
  return { ok: true };
}
