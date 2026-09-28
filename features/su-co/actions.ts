'use server';

import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db, schema } from '@/db/client';
import { requirePerm, withUniqueRetry } from '@/features/receiving/perm';
import { boPhanHopLe } from '@/features/to-chuc/bo-phan';
import {
  GIAI_DOAN, TRANG_THAI, loaiChiPhiHopLe, maSuCo, nguyenNhanHopLe,
} from './phan-loai';
import type { ChiPhiVao, GhiSuCoVao } from './types';

type Ket = { ok: boolean; loi?: string };

const duong = () => revalidatePath('/f/cx/su-co');

/** Chuẩn số tiền về chuỗi 2 chữ số thập phân; không đọc được thì `null`. */
function soTien(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
}

/**
 * Kiểm một dòng chi phí. Trả thông điệp cụ thể chứ không chỉ true/false — người
 * nhập cần biết dòng nào sai ở đâu.
 */
function kiemChiPhi(c: ChiPhiVao, i: number): string | null {
  if (!loaiChiPhiHopLe(c.loai)) return `Dòng chi phí ${i + 1}: loại không hợp lệ.`;
  if (soTien(c.soTien) == null) return `Dòng chi phí ${i + 1}: số tiền không hợp lệ.`;
  const tt = c.tienTe.trim().toUpperCase();
  // Đơn vị tiền bắt buộc: thiếu nó thì con số bị loại khỏi mọi bảng tổng.
  if (!/^[A-Z]{3}$/.test(tt)) return `Dòng chi phí ${i + 1}: đơn vị tiền phải là mã 3 chữ (USD, EUR…).`;
  if (c.boPhan != null && c.boPhan !== '' && !boPhanHopLe(c.boPhan)) {
    return `Dòng chi phí ${i + 1}: bộ phận không hợp lệ.`;
  }
  return null;
}

/** Ghi một sự cố mới cùng các dòng chi phí, trong MỘT transaction. */
export async function ghiSuCo(v: GhiSuCoVao): Promise<Ket & { id?: string; ma?: string }> {
  const actor = await requirePerm('manage_cx_incident');

  if (!v.ngayBao || Number.isNaN(new Date(v.ngayBao).getTime())) {
    return { ok: false, loi: 'Ngày báo không hợp lệ.' };
  }
  if (!nguyenNhanHopLe(v.nguyenNhan)) return { ok: false, loi: 'Nguyên nhân không hợp lệ.' };
  if (v.giaiDoan && !GIAI_DOAN.some((g) => g.ma === v.giaiDoan)) {
    return { ok: false, loi: 'Giai đoạn không hợp lệ.' };
  }
  if (v.boPhanChinh && !boPhanHopLe(v.boPhanChinh)) {
    return { ok: false, loi: 'Bộ phận chịu chính không hợp lệ.' };
  }
  for (const [i, c] of v.chiPhi.entries()) {
    const loi = kiemChiPhi(c, i);
    if (loi) return { ok: false, loi };
  }

  try {
    const ket = await withUniqueRetry(() => db.transaction(async (tx) => {
      const maDon = v.maDon?.trim().replace(/^#/, '') || null;
      let orderId: string | null = null;
      let storeId: string | null = null;
      if (maDon) {
        const [o] = ((await tx.execute(sql`
          SELECT id, store_id FROM shopify_orders
          WHERE regexp_replace(shopify_order_number, '^#', '') = ${maDon} LIMIT 1`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
        if (o) { orderId = String(o.id); storeId = String(o.store_id); }
      }

      const [m] = ((await tx.execute(sql`
        SELECT COALESCE(max((regexp_match(ma_su_co, '^SC-(\\d+)$'))[1]::int), 0) AS n
        FROM su_co WHERE ma_su_co ~ '^SC-\\d+$'`)) as { rows?: Record<string, unknown>[] }).rows ?? [];
      const ma = maSuCo(Number(m?.n ?? 0) + 1);

      const [sc] = await tx.insert(schema.suCo).values({
        maSuCo: ma,
        ngayBao: v.ngayBao,
        nguyenNhan: v.nguyenNhan,
        giaiDoan: v.giaiDoan || null,
        trangThai: 'mo',
        moTa: v.moTa?.trim() || null,
        boPhanChinh: v.boPhanChinh || null,
        maGiamGia: v.maGiamGia?.trim() || null,
        maTicketCs: v.maTicketCs?.trim() || null,
        storeId, orderId,
        maDon: maDon ? `#${maDon}` : null,
        anhKeys: v.anhKeys,
        taoBoi: actor,
      }).returning({ id: schema.suCo.id });
      const id = sc!.id;

      if (v.chiPhi.length > 0) {
        await tx.insert(schema.suCoChiPhi).values(v.chiPhi.map((c) => ({
          suCoId: id,
          loai: c.loai,
          soTien: soTien(c.soTien)!,
          tienTe: c.tienTe.trim().toUpperCase(),
          boPhan: c.boPhan || null,
        })));
      }
      return { id, ma };
    }));
    duong();
    return { ok: true, ...ket };
  } catch (e) {
    console.error('[su-co] ghiSuCo lỗi:', e);
    return { ok: false, loi: e instanceof Error ? e.message : 'Ghi sự cố thất bại.' };
  }
}

/** Thêm một dòng chi phí vào sự cố đã có. */
export async function themChiPhi(suCoId: string, c: ChiPhiVao): Promise<Ket> {
  await requirePerm('manage_cx_incident');
  const loi = kiemChiPhi(c, 0);
  if (loi) return { ok: false, loi: loi.replace('Dòng chi phí 1: ', '') };
  try {
    await db.insert(schema.suCoChiPhi).values({
      suCoId, loai: c.loai, soTien: soTien(c.soTien)!,
      tienTe: c.tienTe.trim().toUpperCase(), boPhan: c.boPhan || null,
    });
    await db.update(schema.suCo).set({ updatedAt: new Date() })
      .where(eq(schema.suCo.id, suCoId));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[su-co] themChiPhi lỗi:', e);
    return { ok: false, loi: 'Thêm dòng chi phí thất bại.' };
  }
}

export async function xoaChiPhi(chiPhiId: string): Promise<Ket> {
  await requirePerm('manage_cx_incident');
  try {
    await db.delete(schema.suCoChiPhi).where(eq(schema.suCoChiPhi.id, chiPhiId));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[su-co] xoaChiPhi lỗi:', e);
    return { ok: false, loi: 'Xoá dòng chi phí thất bại.' };
  }
}

export async function themGhiChuSuCo(suCoId: string, noiDung: string): Promise<Ket> {
  const actor = await requirePerm('manage_cx_incident');
  const s = noiDung.trim();
  if (!s) return { ok: false, loi: 'Ghi chú trống.' };
  try {
    await db.insert(schema.suCoGhiChu).values({ suCoId, noiDung: s, taoBoi: actor });
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[su-co] themGhiChuSuCo lỗi:', e);
    return { ok: false, loi: 'Thêm ghi chú thất bại.' };
  }
}

/** Đổi trạng thái. `xong` ghi mốc đóng; quay lại thì XOÁ mốc để báo cáo không sai. */
export async function doiTrangThaiSuCo(id: string, den: string): Promise<Ket> {
  await requirePerm('manage_cx_incident');
  if (!(TRANG_THAI as readonly string[]).includes(den)) {
    return { ok: false, loi: 'Trạng thái không hợp lệ.' };
  }
  try {
    await db.update(schema.suCo).set({
      trangThai: den, updatedAt: new Date(),
      dongLuc: den === 'xong' ? new Date() : null,
    }).where(eq(schema.suCo.id, id));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[su-co] doiTrangThaiSuCo lỗi:', e);
    return { ok: false, loi: 'Đổi trạng thái thất bại.' };
  }
}

/** Đánh dấu đã rà xong một ca `can_xem_lai` nhập từ Lark. */
export async function daXemLai(id: string): Promise<Ket> {
  await requirePerm('manage_cx_incident');
  try {
    await db.update(schema.suCo).set({ canXemLai: false, updatedAt: new Date() })
      .where(eq(schema.suCo.id, id));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[su-co] daXemLai lỗi:', e);
    return { ok: false, loi: 'Đánh dấu thất bại.' };
  }
}

/** Cập nhật bộ phận chịu chính — việc CX làm nhiều nhất khi rà ca nhập từ Lark. */
export async function doiBoPhanChinh(id: string, boPhan: string | null): Promise<Ket> {
  await requirePerm('manage_cx_incident');
  if (boPhan && !boPhanHopLe(boPhan)) return { ok: false, loi: 'Bộ phận không hợp lệ.' };
  try {
    await db.update(schema.suCo).set({ boPhanChinh: boPhan || null, updatedAt: new Date() })
      .where(eq(schema.suCo.id, id));
    duong();
    return { ok: true };
  } catch (e) {
    console.error('[su-co] doiBoPhanChinh lỗi:', e);
    return { ok: false, loi: 'Đổi bộ phận thất bại.' };
  }
}
