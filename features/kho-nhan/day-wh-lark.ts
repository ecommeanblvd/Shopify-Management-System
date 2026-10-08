'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import {
  createWhInventoryRecord, deleteWhInventoryRecord,
  getWhInventoryRecord, updateWhInventoryRecord, layLuaChonVendorFinal, uploadWhInventoryMedia,
} from '@/features/lark/client';
import { requirePerm } from '@/features/receiving/perm';
import { dongBoAnhLenLark, phieuCuaChiec, kieuTheoTen } from './anh-lark';
import { getObject } from '@/lib/storage/s3';
import { moTaLoiQc } from './mo-ta-loi-qc';
import type { LyDoLoi } from './loi-qc';
import {
  dungPayloadNhan, dungPayloadSauQcDat, dungPayloadSauQcKhongDat, chonVendorHopLe,
  COT_UNIQUE_CODE, type NguonNhan,
} from './wh-lark-payload';
import { quyetDinhGui, duocXoaRecord } from './gui-po-lark';

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
    poOrderNumber: schema.goodsReceiptItems.poOrderNumber,
    poRecordId: schema.goodsReceiptItems.poRecordId,
    tenMonPhieu: schema.goodsReceiptItems.productTitle,
    taoLuc: schema.goodsReceiptItems.createdAt,
    kho: schema.goodsReceipts.warehouseCode,
  })
    .from(schema.goodsReceiptItems)
    .innerJoin(schema.goodsReceipts, eq(schema.goodsReceipts.id, schema.goodsReceiptItems.receiptId))
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(inArray(schema.goodsReceiptItems.id, itemIds));

  /* Đọc một lần cho cả lượt gửi. Hỏng thì coi như không có lựa chọn nào hợp lệ
   * → bỏ trống cột, chứ không chặn cả lượt gửi vì một cột phụ. */
  const vendorHopLe = await layLuaChonVendorFinal().catch((e) => {
    console.error('[kho-nhan] đọc lựa chọn Vendor final lỗi:', e);
    return [] as string[];
  });

  for (const c of dsChiec) {
    if (c.larkRecordId) { ket.boQua.push({ unitCode: c.unitCode, lyDo: 'đã vào chờ QC rồi' }); continue; }
    const duong = quyetDinhGui(c);
    if (!duong.ok) { ket.boQua.push({ unitCode: c.unitCode, lyDo: duong.lyDo }); continue; }

    /* Hai đường, một đích. Khác nhau đúng ba thứ: bảng nào cấp tên hàng và vendor, có liên kết
     * đơn hay không, và loại nhập — `quyetDinhGui` đã chọn, `dungPayloadNhan` lo hai cột cuối. */
    let nguon: NguonNhan;
    let skuFinal = duong.sku;
    let tenMon: string | null = c.tenMonPhieu;
    let vendorTho: string | null = null;

    if (duong.kieu === 'don') {
      // Chuẩn hoá `#` cả hai phía — quên là truy vấn trả rỗng mà không báo lỗi.
      const [mon] = await db.select({
        recordId: schema.larkMonDon.recordId,
        sku: schema.larkMonDon.sku,
        tenMon: schema.larkMonDon.lineitemName,
        vendor: schema.larkMonDon.vendor,
      })
        .from(schema.larkMonDon)
        .where(and(
          sql`regexp_replace(${schema.larkMonDon.orderNumber}, '^#', '') = regexp_replace(${duong.maDon}, '^#', '')`,
          eq(schema.larkMonDon.sku, duong.sku),
        ))
        .limit(1);

      if (!mon?.recordId) {
        ket.boQua.push({ unitCode: c.unitCode, lyDo: 'món này chưa có dòng trên bảng Lark' });
        continue;
      }
      nguon = { kieu: 'don', larkMonRecordId: mon.recordId };
      // `sku` bên lark_mon_don cho phép rỗng; rơi về SKU của chiếc hàng để cột
      // `Lineitem SKU final` không bao giờ trống — trống là `Định danh` cụt.
      skuFinal = mon.sku ?? duong.sku;
      tenMon = mon.tenMon;
      vendorTho = mon.vendor;
    } else {
      /* Hàng PO: KHÔNG tra bảng món (từ PO22 trở đi nó không có dòng nào ở đó), tra thẳng dòng
       * PO bằng `po_record_id` đã ghim lúc nhận. Tra lại theo mã đơn + SKU là tự mở đường chọn
       * nhầm dòng: một PO có nhiều dòng cùng SKU (PO52 có ba dòng cùng một SKU). */
      if (c.poRecordId) {
        const [po] = await db.select({
          tenMon: schema.larkPoDong.lineitemName, vendor: schema.larkPoDong.vendor,
        }).from(schema.larkPoDong).where(eq(schema.larkPoDong.recordId, c.poRecordId)).limit(1);
        if (po) { tenMon = po.tenMon ?? c.tenMonPhieu; vendorTho = po.vendor; }
      }
      nguon = { kieu: 'po' };
    }

    try {
      const recordId = await createWhInventoryRecord(
        dungPayloadNhan({
          nguon,
          // Giữ dấu `#` đúng quy ước bảng Lark. Với đường đơn, số lấy từ `shopify_orders`
          // chứ không từ mirror `lark_mon_don` (mirror đã strip sạch `#`); với đường PO,
          // `po_order_number` chép nguyên từ bảng PO nên đã có `#`.
          maDon: duong.maDon, sku: skuFinal, tenMon,
          vendor: chonVendorHopLe(vendorTho, vendorHopLe),
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
    maDon: schema.shopifyOrders.shopifyOrderNumber,
    poOrderNumber: schema.goodsReceiptItems.poOrderNumber,
    sku: schema.goodsReceiptItems.sku,
  }).from(schema.goodsReceiptItems)
    .leftJoin(schema.shopifyOrders, eq(schema.shopifyOrders.id, schema.goodsReceiptItems.orderId))
    .where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);

  if (!c) return { ok: false, loi: 'Không tìm thấy chiếc hàng.' };
  // HÀNG RÀO 1
  if (!c.larkRecordId) return { ok: false, loi: 'Chiếc này chưa gửi lên Lark.' };

  try {
    // HÀNG RÀO 3 — record đã biến mất thì coi như xong, chỉ dọn cờ bên mình.
    const rec = await getWhInventoryRecord(c.larkRecordId);
    if (rec) {
      /* Hàng PO không bao giờ có liên kết đơn, nên hàng rào liên kết phải đổi sang hàng rào
       * định danh — `duocXoaRecord` giữ cả hai luật, chặt tương đương. */
      const duong = quyetDinhGui(c);
      const mong = duong.ok && duong.kieu === 'po'
        ? { kieu: 'po' as const, maDon: duong.maDon, sku: duong.sku }
        : { kieu: 'don' as const };
      const cho = duocXoaRecord(rec.fields, mong);
      if (!cho.ok) {
        await ghiNhatKy({ hanhDong: 'xoa', larkRecordId: c.larkRecordId, receiptItemId: c.id, thanhCong: false, chiTiet: cho.loi, actor });
        return { ok: false, loi: cho.loi };
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
/**
 * Token Lark của mọi ảnh lỗi QC thuộc một chiếc, tải lên nếu chưa có.
 *
 * Nhớ token vào `wh_loi_qc.lark_file_token`: tải lại cùng một tấm ảnh mỗi lượt ghi là đẻ ra
 * hàng loạt bản y hệt nhau trong Drive của đội — đúng lỗi mà `wh_anh_nhan` đã tránh.
 *
 * Tải hỏng một tấm thì BỎ QUA tấm đó, các tấm còn lại vẫn lên: mất một ảnh còn hơn mất cả lượt
 * báo lỗi.
 */
async function tokenAnhLoi(itemId: string): Promise<string[]> {
  const dong = await db.select().from(schema.whLoiQc)
    .where(eq(schema.whLoiQc.receiptItemId, itemId));
  const ra: string[] = [];
  for (const d of dong) {
    if (!d.anhKey) continue;
    if (d.larkFileToken) { ra.push(d.larkFileToken); continue; }
    try {
      const bytes = await getObject(d.anhKey);
      const ten = d.anhKey.split('/').pop() ?? 'anh-loi-qc.jpg';
      const token = await uploadWhInventoryMedia(ten, bytes, kieuTheoTen(ten));
      await db.update(schema.whLoiQc).set({ larkFileToken: token })
        .where(eq(schema.whLoiQc.id, d.id));
      ra.push(token);
    } catch (e) {
      console.error(`[kho-nhan] tải ảnh lỗi QC ${d.id} lên Lark hỏng:`, e);
    }
  }
  return ra;
}

/**
 * QC KHÔNG ĐẠT → ghi `QC Check`, `WH - Action`, `Lý do QC failed` và ảnh lỗi lên Lark.
 *
 * Trước 03/10/2026 hàm này chỉ ghi `QC Check`. Bảo báo ba triệu chứng — lý do không tự điền,
 * action vẫn đứng ở " Chờ QC ", ảnh không đẩy — và cả ba là cùng một chỗ thiếu ấy. Đội kho vẫn
 * điền đủ bên mình (7/7 dòng lỗi có ảnh ngày 02/10) nhưng không gì tới bảng vận hành.
 *
 * Gọi được NHIỀU LẦN cho một chiếc: kho bổ sung lỗi hoặc ảnh sau thì gọi lại, nội dung ghi đè
 * là ảnh chụp mới nhất của toàn bộ dòng lỗi — không cộng dồn, không nhân bản.
 *
 * Best-effort: Lark hỏng KHÔNG được làm hỏng việc đã ghi xong bên mình, nhưng phải vào nhật ký
 * để còn chữa.
 */
export async function danhDauQcKhongDatTrenLark(itemId: string, actor: string): Promise<void> {
  const [c] = await db.select({ larkRecordId: schema.goodsReceiptItems.larkRecordId })
    .from(schema.goodsReceiptItems).where(eq(schema.goodsReceiptItems.id, itemId)).limit(1);
  if (!c?.larkRecordId) return;
  try {
    const dong = await db.select({ lyDo: schema.whLoiQc.lyDo, ghiChu: schema.whLoiQc.ghiChu })
      .from(schema.whLoiQc).where(eq(schema.whLoiQc.receiptItemId, itemId));
    const lyDo = moTaLoiQc(dong.map((d) => ({ lyDo: d.lyDo as LyDoLoi, ghiChu: d.ghiChu })));
    const anh = await tokenAnhLoi(itemId);
    /* ĐỌC TRƯỚC KHI GHI. Ba cột này đang có chữ và ảnh người dán tay (456 lý do, 429 ảnh trên
     * 463 dòng QC Failed) vì hệ thống chưa đẩy được. `dungPayloadSauQcKhongDat` chỉ nối thêm
     * phần còn thiếu, nhưng nó cần biết đang có gì — không đọc được thì nó tự thu về ghi đúng
     * một cột `QC Check`. */
    const banGhi = await getWhInventoryRecord(c.larkRecordId);
    const payload = dungPayloadSauQcKhongDat(banGhi?.fields ?? null, { lyDo, anh });
    await updateWhInventoryRecord(c.larkRecordId, payload);
    await ghiNhatKy({ hanhDong: 'sua', larkRecordId: c.larkRecordId, receiptItemId: itemId,
      thanhCong: true, actor,
      chiTiet: `QC Failed · ghi ${Object.keys(payload).join(', ')} · lý do "${lyDo}" · ${anh.length} ảnh`,
    });
  } catch (e) {
    const chiTiet = e instanceof Error ? e.message : String(e);
    await ghiNhatKy({ hanhDong: 'sua', larkRecordId: c.larkRecordId, receiptItemId: itemId, thanhCong: false, chiTiet, actor });
    console.error('[kho-nhan] danhDauQcKhongDatTrenLark lỗi:', e);
  }
}
