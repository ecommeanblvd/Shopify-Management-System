'use server';

import { inArray, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { updateWhInventoryRecord, uploadWhInventoryMedia, getWhInventoryRecord } from '@/features/lark/client';
import {
  COT_LARK, CONG_THEM, TEN_LOAI, dongDuocGan, gopToken, kiemFile, oDinhKem, tokenTuO,
  type DongKho, type LoaiFile,
} from './bo-sung-anh';

export interface KetQuaBoSung { ok: boolean; loi?: string; soDong?: number; soFile?: number }

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

/**
 * Bổ sung ảnh / BBGN cho dòng Sổ nhập đã nhận hàng mà quên đính (CEO 29/09/2026).
 *
 * Ghi THẲNG vào bảng Lark của kho vì 5.300 dòng thiếu ảnh không có phiếu nhận
 * bên SMS (chỉ 6/9.162 dòng do SMS tạo) nên `dongBoAnhLenLark` không với tới.
 *
 * Từ 03/10/2026 nhận thêm ẢNH LỖI QC (CEO yêu cầu): cột `Ảnh lỗi` trên Sổ nhập cũng dán/tải
 * được như hai cột kia. Luật của nó khác — chỉ đúng một dòng, và CỘNG THÊM — xem `CONG_THEM`.
 *
 * Ba chốt chặn, vì đây là bảng đội kho đang vận hành:
 *  - KHÔNG BAO GIỜ GỠ file đang có. Ảnh hàng đến / biên bản thì bỏ qua hẳn dòng đã có file;
 *    ảnh lỗi thì nối tấm mới vào sau tấm cũ;
 *  - file tải lên Lark ĐÚNG MỘT LẦN rồi dùng lại token cho mọi dòng, không đẻ
 *    hàng loạt bản y hệt trong Drive của đội;
 *  - đọc lại record trước khi ghi, không dựa vào bản sao trong SMS (bản sao có
 *    thể cũ tới một giờ) — ô có thể vừa được đội kho điền tay.
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
    /** Ô đính kèm sau khi ghi, để cập nhật bản sao mà không phải đọc Lark thêm lượt nữa. */
    let anhSau: { token: string; ten: string }[] = [];
    for (const id of nhan) {
      // Đọc lại từ Lark: bản sao trong SMS có thể cũ tới một giờ, và ghi đè một
      // ô vừa được đội kho điền tay là mất file của họ.
      const rec = await getWhInventoryRecord(id);
      const dangCo = (rec?.fields as Record<string, unknown> | undefined)?.[COT_LARK[loai]];

      if (!CONG_THEM[loai]) {
        if (Array.isArray(dangCo) && dangCo.length > 0) continue;
        await updateWhInventoryRecord(id, { [COT_LARK[loai]]: o });
        daGhi += 1;
        continue;
      }

      /* Ảnh lỗi QC: CỘNG THÊM. Ô đã có ảnh — thường là ảnh đội đóng hàng dán tay — thì giữ
       * nguyên rồi nối tấm mới vào sau. Cùng luật với lượt báo lỗi tự động. */
      const cu = tokenTuO(dangCo);
      const gop = gopToken(cu, tokens);
      if (gop.length === cu.length) continue;          // không có gì mới để thêm
      await updateWhInventoryRecord(id, { [COT_LARK[loai]]: oDinhKem(gop) });
      daGhi += 1;
      const tenCu = Array.isArray(dangCo)
        ? (dangCo as { file_token?: string; name?: string }[])
            .filter((x) => x?.file_token)
            .map((x) => ({ token: x.file_token!, ten: x.name ?? '' }))
        : [];
      anhSau = [...tenCu, ...files.map((f, k) => ({ token: tokens[k]!, ten: f.name }))
        .filter((x) => !cu.includes(x.token))];
    }

    // Cập nhật bản sao để màn hình hiện ngay, không phải đợi lượt đồng bộ sau.
    if (CONG_THEM[loai]) {
      if (daGhi > 0) {
        await db.update(schema.larkWhInventory).set({ anhLoiQc: anhSau })
          .where(inArray(schema.larkWhInventory.recordId, nhan));
      }
    } else {
      await db.update(schema.larkWhInventory)
        .set(loai === 'hang_den' ? { coAnhHangDen: true } : { coBbBanGiao: true })
        .where(inArray(schema.larkWhInventory.recordId, nhan));
    }

    /* Trang Sổ nhập nằm ở `/f/warehouse/dong-bo`. Đường cũ `/f/warehouse/so-nhap` KHÔNG tồn
     * tại, nên từ 29/09 tới nay lượt bổ sung file chưa bao giờ làm trang tự mới lại — người
     * tải phải tự tải lại trang mới thấy. Hỏng im lặng, không ai báo. */
    revalidatePath('/f/warehouse/dong-bo');
    return { ok: true, soDong: daGhi, soFile: files.length };
  } catch (e) {
    console.error('[kho-nhan] boSungFileLark lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Đẩy tệp lên Lark thất bại.' };
  }
}
