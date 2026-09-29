'use server';

import { inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { updateWhInventoryRecord, uploadWhInventoryMedia, getWhInventoryRecord } from '@/features/lark/client';
import { COT_LARK, TEN_LOAI, dongDuocGan, kiemFile, oDinhKem, type DongKho, type LoaiFile } from './bo-sung-anh';

export interface KetQuaBoSung { ok: boolean; loi?: string; soDong?: number; soFile?: number }

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/**
 * Bổ sung ảnh / BBGN cho dòng Sổ nhập đã nhận hàng mà quên đính (CEO 29/09/2026).
 *
 * Ghi THẲNG vào bảng Lark của kho vì 5.300 dòng thiếu ảnh không có phiếu nhận
 * bên SMS (chỉ 6/9.162 dòng do SMS tạo) nên `dongBoAnhLenLark` không với tới.
 *
 * Ba chốt chặn, vì đây là bảng đội kho đang vận hành:
 *  - chỉ gắn vào dòng CHƯA có file loại đó — không bao giờ đè thứ đội kho đã đưa lên;
 *  - file tải lên Lark ĐÚNG MỘT LẦN rồi dùng lại token cho mọi dòng, không đẻ
 *    hàng loạt bản y hệt trong Drive của đội;
 *  - đọc lại record trước khi ghi để chắc chắn ô đó đang trống THẬT, không dựa
 *    vào bản sao trong SMS (bản sao có thể cũ tới một giờ).
 */
export async function boSungFileLark(
  recordIdGoc: string, loai: LoaiFile, form: FormData,
): Promise<KetQuaBoSung> {
  await requirePerm('manage_warehouse');

  const files = form.getAll('file').filter((x): x is File => x instanceof File);
  if (files.length === 0) return { ok: false, loi: 'Chưa chọn tệp nào.' };
  for (const f of files) {
    const loi = kiemFile(f.name, f.type, f.size);
    if (loi) return { ok: false, loi };
  }

  const [goc] = rows<DongKho>(await db.execute(sql`
    SELECT record_id AS "recordId", ngay_import::text AS "ngayImport", order_number AS "orderNumber",
           co_anh_hang_den AS "coAnhHangDen", co_bb_ban_giao AS "coBbBanGiao"
    FROM lark_wh_inventory WHERE record_id = ${recordIdGoc}`));
  if (!goc) return { ok: false, loi: 'Không thấy dòng này trong Sổ nhập.' };

  const cungDon = rows<DongKho>(await db.execute(sql`
    SELECT record_id AS "recordId", ngay_import::text AS "ngayImport", order_number AS "orderNumber",
           co_anh_hang_den AS "coAnhHangDen", co_bb_ban_giao AS "coBbBanGiao"
    FROM lark_wh_inventory
    WHERE ngay_import = ${goc.ngayImport}::date
      AND order_number IS NOT DISTINCT FROM ${goc.orderNumber}`));

  const nhan = dongDuocGan(cungDon, goc, loai);
  if (nhan.length === 0) return { ok: false, loi: `Dòng này đã có ${TEN_LOAI[loai].toLowerCase()} rồi.` };

  try {
    // Tải MỘT lần, dùng token cho mọi dòng.
    const tokens: string[] = [];
    for (const f of files) {
      tokens.push(await uploadWhInventoryMedia(f.name, Buffer.from(await f.arrayBuffer()), f.type));
    }
    const o = oDinhKem(tokens);

    let daGhi = 0;
    for (const id of nhan) {
      // Đọc lại từ Lark: bản sao trong SMS có thể cũ tới một giờ, và ghi đè một
      // ô vừa được đội kho điền tay là mất file của họ.
      const rec = await getWhInventoryRecord(id);
      const dangCo = (rec?.fields as Record<string, unknown> | undefined)?.[COT_LARK[loai]];
      if (Array.isArray(dangCo) && dangCo.length > 0) continue;
      await updateWhInventoryRecord(id, { [COT_LARK[loai]]: o });
      daGhi += 1;
    }

    // Cập nhật bản sao để màn hình hiện ngay, không phải đợi lượt đồng bộ sau.
    await db.update(schema.larkWhInventory)
      .set(loai === 'hang_den' ? { coAnhHangDen: true } : { coBbBanGiao: true })
      .where(inArray(schema.larkWhInventory.recordId, nhan));

    revalidatePath('/f/warehouse/so-nhap');
    return { ok: true, soDong: daGhi, soFile: files.length };
  } catch (e) {
    console.error('[kho-nhan] boSungFileLark lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Đẩy tệp lên Lark thất bại.' };
  }
}
