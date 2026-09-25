'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import {
  createWhInventoryRecord, deleteWhInventoryRecord,
  getWhInventoryRecord, updateWhInventoryRecord,
} from '@/features/lark/client';
import { requirePerm } from '@/features/receiving/perm';
import { dongBoAnhLenLark, phieuCuaChiec } from './anh-lark';
import {
  dungPayloadNhan, dungPayloadSauQcDat, dungPayloadSauQcKhongDat,
  COT_SELECT_ORDER, COT_UNIQUE_CODE,
} from './wh-lark-payload';

async function ghiNhatKy(d: {
  hanhDong: 'tao' | 'xoa' | 'sua'; larkRecordId: string | null;
  receiptItemId: string | null; thanhCong: boolean; chiTiet: string | null; actor: string;
}): Promise<void> {
  try {
    await db.insert(schema.whLarkNhatKy).values(d);
  } catch (e) {
    // Nhật ký hỏng KHÔNG được làm hỏng thao tác — nhưng phải kêu lên.
    console.error('[kho-nhan] ghi nhật ký Lark lỗi:', e);
  }
}

export interface KetQuaGui {
  daGui: number;
  boQua: { unitCode: string; lyDo: string }[];
}

/**
 * Bấm "Gửi": tạo dòng trên bảng Lark WH - Inventory cho các chiếc đang kiểm.
 *
 * CEO 24/09: kho gom danh sách trên UI, sửa ra sửa vào thoải mái, rồi mới bấm
 * MỘT nút gửi. Nên đây là thao tác TAY, không phải cron — chính cú bấm là cửa
 * kiểm soát.
 *
 * Chiếc đã có `lark_record_id` thì BỎ QUA, không tạo lần hai: gửi trùng là hai
 * dòng cho một chiếc hàng trên bảng vận hành.
 */
export async function guiLenLark(itemIds: string[]): Promise<KetQuaGui> {
  const actor = await requirePerm('manage_qc');
  const ket: KetQuaGui = { daGui: 0, boQua: [] };
  if (itemIds.length === 0) return ket;

  const dsChiec = await db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    sku: schema.goodsReceiptItems.sku,
    larkRecordId: schema.goodsReceiptItems.larkRecordId,
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    taoLuc: schema.goodsReceiptItems.createdAt,
    kho: schema.goodsReceipts.warehouseCode,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(inArray(schema.goodsReceiptItems.id, itemIds));

  for (const c of dsChiec) {
    if (c.larkRecordId) { ket.boQua.push({ unitCode: c.unitCode, lyDo: 'đã vào chờ QC rồi' }); continue; }
    if (!c.maDon || !c.sku) { ket.boQua.push({ unitCode: c.unitCode, lyDo: 'thiếu mã đơn hoặc SKU' }); continue; }

    // Chuẩn hoá `#` cả hai phía — quên là truy vấn trả rỗng mà không báo lỗi.
    const [mon] = await db.select({
      recordId: schema.larkMonDon.recordId,
      maDon: schema.larkMonDon.orderNumber,
      sku: schema.larkMonDon.sku,
      tenMon: schema.larkMonDon.lineitemName,
    })
      .from(schema.larkMonDon)
      .where(and(
        sql`regexp_replace(${schema.larkMonDon.orderNumber}, '^#', '') = regexp_replace(${c.maDon}, '^#', '')`,
        eq(schema.larkMonDon.sku, c.sku),
      ))
      .limit(1);

    if (!mon?.recordId) {
      ket.boQua.push({ unitCode: c.unitCode, lyDo: 'món này chưa có dòng trên bảng Lark' });
      continue;
    }
    // `sku` bên lark_mon_don cho phép rỗng; rơi về SKU của chiếc hàng để cột
    // `Lineitem SKU final` không bao giờ trống — trống là `Định danh` cụt.
    const skuFinal = mon.sku ?? c.sku;

    try {
      const recordId = await createWhInventoryRecord(
        dungPayloadNhan({
          larkMonRecordId: mon.recordId,
          // Số đơn của Shopify — giữ dấu `#` đúng quy ước store; bản mirror
          // `lark_mon_don` đã strip sạch `#` nên không dùng được cho cột này.
          maDon: c.maDon, sku: skuFinal, tenMon: mon.tenMon,
          nhanLuc: c.taoLuc, kho: c.kho,
        }),
      );
      /* Đọc ngược `WH - Unique code` — AutoNumber Lark sinh lúc tạo, mình không
       * đoán được. Thiếu nó thì Sổ nhập vĩnh viễn không dựng lại được cột
       * `Định danh` để đối chiếu. Đọc hỏng KHÔNG được làm hỏng lượt gửi đã
       * thành công: record đã có trên Lark rồi, mất mã chỉ là mất tiện nghi. */
      let uniqueCode: string | null = null;
      try {
        const rec = await getWhInventoryRecord(recordId);
        const v = rec?.fields?.[COT_UNIQUE_CODE];
        uniqueCode = typeof v === 'string' ? v
          : Array.isArray(v) ? (v.map((x) => (x as { text?: string })?.text ?? '').join('') || null)
          : v == null ? null : String(v);
      } catch (e) {
        console.error('[kho-nhan] đọc WH - Unique code lỗi:', e);
      }

      await db.update(schema.goodsReceiptItems)
        .set({ larkRecordId: recordId, larkUniqueCode: uniqueCode, updatedAt: new Date() })
        .where(and(eq(schema.goodsReceiptItems.id, c.id), isNull(schema.goodsReceiptItems.larkRecordId)));
      await ghiNhatKy({ hanhDong: 'tao', larkRecordId: recordId, receiptItemId: c.id, thanhCong: true, chiTiet: null, actor });
      ket.daGui += 1;
    } catch (e) {
      const chiTiet = e instanceof Error ? e.message : String(e);
      await ghiNhatKy({ hanhDong: 'tao', larkRecordId: null, receiptItemId: c.id, thanhCong: false, chiTiet, actor });
      ket.boQua.push({ unitCode: c.unitCode, lyDo: `Lark từ chối: ${chiTiet}` });
    }
  }

  // Dòng đã có trên Lark rồi mới gắn được ảnh vào. Ảnh nào kho tải sau thì
  // `themAnhNhan` tự đẩy tiếp, nên không cần bắt kho phải tải trước khi gửi.
  if (ket.daGui > 0) {
    for (const phieu of await phieuCuaChiec(itemIds)) await dongBoAnhLenLark(phieu);
  }

  revalidatePath('/f/warehouse/nhan-kcs');
  return ket;
}

/**
 * Gỡ MỘT chiếc khỏi bảng Lark. Bốn hàng rào CEO chốt 24/09:
 *  1. chỉ xoá record có id ĐÃ LƯU trên chính chiếc đó — không bao giờ xoá theo
 *     điều kiện lọc;
 *  2. MỘT record mỗi lượt gọi — hàm này không nhận mảng, không có vòng lặp xoá;
 *  3. ĐỌC LẠI và đối chiếu liên kết trước khi xoá;
 *  4. ghi nhật ký mọi lượt, kể cả lượt hỏng.
 */
export async function goKhoiLark(itemId: string): Promise<{ ok: boolean; loi?: string }> {
  const actor = await requirePerm('manage_qc');
  const [c] = await db.select({
    id: schema.goodsReceiptItems.id,
    unitCode: schema.goodsReceiptItems.unitCode,
    larkRecordId: schema.goodsReceiptItems.larkRecordId,
  }).from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);

  if (!c) return { ok: false, loi: 'Không tìm thấy chiếc hàng.' };
  // HÀNG RÀO 1
  if (!c.larkRecordId) return { ok: false, loi: 'Chiếc này chưa gửi lên Lark.' };

  try {
    // HÀNG RÀO 3 — record đã biến mất thì coi như xong, chỉ dọn cờ bên mình.
    const rec = await getWhInventoryRecord(c.larkRecordId);
    if (rec) {
      const lien = rec.fields?.[COT_SELECT_ORDER] as { record_ids?: string[] }[] | undefined;
      const coLien = Array.isArray(lien) && lien.some((x) => (x.record_ids ?? []).length > 0);
      if (!coLien) {
        const loi = 'Record trên Lark không còn liên kết món — KHÔNG xoá, cần người kiểm tay.';
        await ghiNhatKy({ hanhDong: 'xoa', larkRecordId: c.larkRecordId, receiptItemId: c.id, thanhCong: false, chiTiet: loi, actor });
        return { ok: false, loi };
      }
      await deleteWhInventoryRecord(c.larkRecordId);
    }

    await db.update(schema.goodsReceiptItems)
      .set({ larkRecordId: null, updatedAt: new Date() })
      .where(eq(schema.goodsReceiptItems.id, itemId));
    await ghiNhatKy({
      hanhDong: 'xoa', larkRecordId: c.larkRecordId, receiptItemId: c.id,
      thanhCong: true, chiTiet: rec ? null : 'record đã không còn trên Lark', actor,
    });
    return { ok: true };
  } catch (e) {
    const chiTiet = e instanceof Error ? e.message : String(e);
    await ghiNhatKy({ hanhDong: 'xoa', larkRecordId: c.larkRecordId, receiptItemId: c.id, thanhCong: false, chiTiet, actor });
    console.error('[kho-nhan] goKhoiLark lỗi:', e);
    return { ok: false, loi: `Gỡ thất bại: ${chiTiet}` };
  }
}

/**
 * QC ĐẠT → đổi cột WH - Action trên Lark sang "Tạm nhập (đi đơn)".
 *
 * Best-effort: Lark hỏng KHÔNG được làm hỏng việc nhập kho đã xong ở phía mình.
 * Lượt hỏng vẫn vào nhật ký để còn biết mà chữa.
 */
export async function danhDauQcDatTrenLark(itemId: string, actor: string): Promise<void> {
  const [c] = await db.select({ larkRecordId: schema.goodsReceiptItems.larkRecordId })
    .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);
  if (!c?.larkRecordId) return;
  try {
    await updateWhInventoryRecord(c.larkRecordId, dungPayloadSauQcDat());
    await ghiNhatKy({ hanhDong: 'sua', larkRecordId: c.larkRecordId, receiptItemId: itemId, thanhCong: true, chiTiet: 'WH - Action → Tạm nhập (đi đơn)', actor });
  } catch (e) {
    const chiTiet = e instanceof Error ? e.message : String(e);
    await ghiNhatKy({ hanhDong: 'sua', larkRecordId: c.larkRecordId, receiptItemId: itemId, thanhCong: false, chiTiet, actor });
    console.error('[kho-nhan] danhDauQcDatTrenLark lỗi:', e);
  }
}

/**
 * QC KHÔNG ĐẠT → ghi `QC Check = QC Failed` lên Lark.
 *
 * Trước đây luồng hỏng KHÔNG ghi gì sang Lark cả: chiếc trượt QC vẫn nằm im ở
 * " Chờ QC " trên bảng vận hành, các bộ phận khác không hề biết. Đo 25/09: đội
 * kho điền `QC Check` 100% và đang có 131 dòng QC Failed — bỏ trống là dòng
 * của mình thủng đúng con số đó.
 *
 * Best-effort như lượt QC đạt: Lark hỏng không được làm hỏng việc đã ghi xong
 * bên mình, nhưng phải vào nhật ký để còn chữa.
 */
export async function danhDauQcKhongDatTrenLark(itemId: string, actor: string): Promise<void> {
  const [c] = await db.select({ larkRecordId: schema.goodsReceiptItems.larkRecordId })
    .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);
  if (!c?.larkRecordId) return;
  try {
    await updateWhInventoryRecord(c.larkRecordId, dungPayloadSauQcKhongDat());
    await ghiNhatKy({ hanhDong: 'sua', larkRecordId: c.larkRecordId, receiptItemId: itemId, thanhCong: true, chiTiet: 'QC Check → QC Failed', actor });
  } catch (e) {
    const chiTiet = e instanceof Error ? e.message : String(e);
    await ghiNhatKy({ hanhDong: 'sua', larkRecordId: c.larkRecordId, receiptItemId: itemId, thanhCong: false, chiTiet, actor });
    console.error('[kho-nhan] danhDauQcKhongDatTrenLark lỗi:', e);
  }
}
