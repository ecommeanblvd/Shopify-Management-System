'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { KHO_SANG_LARK } from './wh-lark-payload';
import type { DongSoNhap } from './types';



/**
 * SỔ NHẬP KHO — đọc BẢN SAO bảng Lark, không đọc `goods_receipt_items`.
 *
 * Vì sao: phần lớn dòng trên Lark do đội kho nhập thẳng bên đó. Bên mình chỉ
 * có 836 dòng (833 của luồng cũ dồn vào ngày import 11/06, cộng 3 dòng mới)
 * trong khi Lark có 9.122 dòng trải 437 ngày. Đọc dữ liệu của mình thì trang
 * mang tên "đối chiếu" mà chỉ thấy đúng một bên.
 *
 * `cuaHeThong` đánh dấu dòng do CHÍNH hệ thống này tạo — nối theo
 * `goods_receipt_items.lark_record_id`.
 */
export async function soNhap(loc: { kho?: string; ngay: string }): Promise<DongSoNhap[]> {
  await requirePerm('view_receiving');
  const khoLark = loc.kho ? KHO_SANG_LARK[loc.kho] ?? loc.kho : null;

  /* MỘT ngày mỗi lượt (bản thiết kế 26/09): màn có lịch chọn ngày nên không
   * cần kéo nhiều ngày, và giới hạn theo ngày thì không ngày nào bị cắt cụt. */
  const r = await db.execute(sql`
    SELECT w.record_id, w.ngay_import, w.dinh_danh, w.warehouse, w.inventory_type,
           w.order_number, w.sku, w.lineitem_name, w.store_final, w.vendor_final,
           w.qc_check, w.wh_action, w.unique_code, w.so_luong,
           w.co_anh_hang_den, w.co_bb_ban_giao,
           EXISTS (SELECT 1 FROM goods_receipt_items gi
                    WHERE gi.lark_record_id = w.record_id) AS cua_he_thong
    FROM lark_wh_inventory w
    WHERE w.ngay_import = ${loc.ngay}::date
      AND (${khoLark}::text IS NULL OR w.warehouse = ${khoLark})
    ORDER BY w.order_number NULLS LAST, w.unique_code`);

  return ((r.rows ?? r) as Record<string, unknown>[]).map((x) => ({
    recordId: String(x.record_id),
    ngayImport: x.ngay_import == null ? null : String(x.ngay_import),
    dinhDanh: (x.dinh_danh as string) ?? null,
    warehouse: (x.warehouse as string) ?? null,
    inventoryType: (x.inventory_type as string) ?? null,
    orderNumber: (x.order_number as string) ?? null,
    sku: (x.sku as string) ?? null,
    lineitemName: (x.lineitem_name as string) ?? null,
    storeFinal: (x.store_final as string) ?? null,
    vendorFinal: (x.vendor_final as string) ?? null,
    qcCheck: (x.qc_check as string) ?? null,
    whAction: (x.wh_action as string) ?? null,
    uniqueCode: (x.unique_code as string) ?? null,
    soLuong: x.so_luong == null ? null : Number(x.so_luong),
    coAnhHangDen: Boolean(x.co_anh_hang_den),
    coBbBanGiao: Boolean(x.co_bb_ban_giao),
    cuaHeThong: Boolean(x.cua_he_thong),
  }));
}

/** Lúc bản sao được kéo về gần nhất — trang phải nói rõ mình đang xem bản cũ cỡ nào. */
export async function larkCapNhatLuc(): Promise<Date | null> {
  await requirePerm('view_receiving');
  const r = await db.execute(sql`SELECT max(cap_nhat_luc) AS luc FROM lark_wh_inventory`);
  const luc = ((r.rows ?? r) as { luc: string | null }[])[0]?.luc;
  return luc ? new Date(luc) : null;
}

/** Các ngày CÓ dòng, để lịch chấm dấu ngày nào có hàng. Giới hạn 400 ngày gần nhất. */
export async function ngayCoDong(kho?: string): Promise<string[]> {
  await requirePerm('view_receiving');
  const khoLark = kho ? KHO_SANG_LARK[kho] ?? kho : null;
  const r = await db.execute(sql`
    SELECT ngay_import::text AS ngay FROM lark_wh_inventory
    WHERE ngay_import IS NOT NULL
      AND (${khoLark}::text IS NULL OR warehouse = ${khoLark})
    GROUP BY 1 ORDER BY 1 DESC LIMIT 400`);
  return ((r.rows ?? r) as { ngay: string }[]).map((x) => x.ngay);
}
