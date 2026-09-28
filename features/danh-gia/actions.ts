'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm, withUniqueRetry } from '@/features/receiving/perm';
import {
  locQuocGia, mapKenh, mapTrang, mapTrangThai, maDanhGia, soSaoHopLe,
} from './phan-loai';
import type { GhiDanhGiaVao } from './types';

type Ket = { ok: boolean; loi?: string };

const duong = () => revalidatePath('/f/cx/danh-gia');

/**
 * Ghi một đánh giá. Hai ô nội dung và ghi chú CX TÁCH RIÊNG — bảng Lark dồn cả hai
 * vào một cột nên về sau không lọc được lời khách ra khỏi phân tích nội bộ.
 */
export async function ghiDanhGia(v: GhiDanhGiaVao): Promise<Ket & { id?: string; ma?: string }> {
  const actor = await requirePerm('manage_cx_review');

  if (!v.ngay || Number.isNaN(new Date(v.ngay).getTime())) {
    return { ok: false, loi: 'Ngày không hợp lệ.' };
  }
  if (!soSaoHopLe(v.soSao)) return { ok: false, loi: 'Số sao phải là số nguyên từ 1 đến 5.' };

  // Giá trị lạ về null thay vì chặn: người nhập chọn từ dropdown nên lạ chỉ xảy ra
  // khi gọi trực tiếp, và null là trạng thái hợp lệ của mọi cột này.
  const trang = v.trang ? mapTrang(v.trang) : null;
  const trangThai = v.trangThai ? mapTrangThai(v.trangThai) : null;
  const kenh = v.kenhLienHe ? mapKenh(v.kenhLienHe) : null;

  try {
    const ket = await withUniqueRetry(() => db.transaction(async (tx) => {
      const maDon = v.maDon?.trim().replace(/^#/, '') || null;
      let orderId: string | null = null;
      let storeId: string | null = null;
      let vendor = v.vendor?.trim() || null;
      if (maDon) {
        const [o] = ((await tx.execute(sql`
          SELECT id, store_id FROM shopify_orders
          WHERE regexp_replace(shopify_order_number, '^#', '') = ${maDon} LIMIT 1`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
        if (o) {
          orderId = String(o.id);
          storeId = String(o.store_id);
          // Tự điền vendor CHỈ KHI đơn có đúng MỘT brand. Nhiều brand thì để trống:
          // chọn bừa một brand là gán đánh giá tệ cho bên có thể không gây ra nó.
          if (!vendor) {
            const vs = ((await tx.execute(sql`
              SELECT DISTINCT vendor FROM shopify_order_lines
              WHERE order_id = ${orderId}::uuid AND vendor IS NOT NULL`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
            if (vs.length === 1) vendor = String(vs[0]!.vendor);
          }
        }
      }

      const [m] = ((await tx.execute(sql`
        SELECT COALESCE(max((regexp_match(ma_danh_gia, '^DG-(\\d+)$'))[1]::int), 0) AS n
        FROM danh_gia WHERE ma_danh_gia ~ '^DG-\\d+$'`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
      const ma = maDanhGia(Number(m?.n ?? 0) + 1);

      const [dg] = await tx.insert(schema.danhGia).values({
        maDanhGia: ma,
        ngay: v.ngay,
        soSao: Number(v.soSao),
        trang, trangThai, kenhLienHe: kenh,
        noiDung: v.noiDung?.trim() || null,
        ghiChuCx: v.ghiChuCx?.trim() || null,
        quocGia: locQuocGia(v.quocGia),
        khachEmail: v.khachEmail?.trim() || null,
        khachTen: v.khachTen?.trim() || null,
        storeId, orderId,
        maDon: maDon ? `#${maDon}` : null,
        vendor,
        theoDoi: v.theoDoi?.trim() || null,
        taoBoi: actor,
      }).returning({ id: schema.danhGia.id });
      return { id: dg!.id, ma };
    }));
    duong();
    return { ok: true, ...ket };
  } catch (e) {
    console.error('[danh-gia] ghiDanhGia lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Ghi đánh giá thất bại.' };
  }
}

/** Đổi trạng thái xử lý. */
export async function doiTrangThaiDanhGia(id: string, den: string | null): Promise<Ket> {
  await requirePerm('manage_cx_review');
  const tt = den ? mapTrangThai(den) : null;
  if (den && !tt) return { ok: false, loi: 'Trạng thái không hợp lệ.' };
  try {
    await db.update(schema.danhGia).set({ trangThai: tt, updatedAt: new Date() })
      .where(eq(schema.danhGia.id, id));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[danh-gia] doiTrangThaiDanhGia lỗi:', e);
    return { ok: false, loi: 'Đổi trạng thái thất bại.' };
  }
}

/**
 * Cập nhật phần CX tự quản: theo dõi/xử lý, ghi chú, brand.
 *
 * `vendor` sửa được tay vì đơn nhiều brand thì hệ thống cố ý để trống — CX là
 * người biết đánh giá nói về sản phẩm của brand nào.
 */
export async function suaPhanCxDanhGia(
  id: string, theoDoi: string | null, ghiChuCx: string | null, vendor: string | null,
): Promise<Ket> {
  await requirePerm('manage_cx_review');
  try {
    await db.update(schema.danhGia).set({
      theoDoi: theoDoi?.trim() || null,
      ghiChuCx: ghiChuCx?.trim() || null,
      vendor: vendor?.trim() || null,
      updatedAt: new Date(),
    }).where(eq(schema.danhGia.id, id));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[danh-gia] suaPhanCxDanhGia lỗi:', e);
    return { ok: false, loi: 'Lưu thất bại.' };
  }
}
