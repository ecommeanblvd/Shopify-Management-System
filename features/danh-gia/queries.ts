'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { requirePerm } from '@/features/receiving/perm';
import { canChua, gomTheoBrand, gomTheoSao, type DongDanhGia, type NhomBrand, type NhomSao } from './tong-hop';
import type { DongDanhGiaUI, LocDanhGia } from './types';

const rows = <T>(r: unknown): T[] => ((r as { rows?: T[] }).rows ?? (r as T[]));

const CHON = sql`
  d.id, d.ma_danh_gia, d.ngay, d.so_sao, d.trang, d.noi_dung, d.ghi_chu_cx,
  d.trang_thai, d.kenh_lien_he, d.quoc_gia, d.khach_email, d.khach_ten,
  d.ma_don, d.order_id, d.vendor, d.theo_doi, d.lark_record_id, s.name AS store`;

function doiDong(x: Record<string, unknown>): DongDanhGiaUI {
  return {
    id: String(x.id),
    maDanhGia: String(x.ma_danh_gia),
    ngay: String(x.ngay),
    soSao: Number(x.so_sao),
    trang: (x.trang as string) ?? null,
    noiDung: (x.noi_dung as string) ?? null,
    ghiChuCx: (x.ghi_chu_cx as string) ?? null,
    trangThai: (x.trang_thai as string) ?? null,
    kenhLienHe: (x.kenh_lien_he as string) ?? null,
    quocGia: (x.quoc_gia as string) ?? null,
    khachEmail: (x.khach_email as string) ?? null,
    khachTen: (x.khach_ten as string) ?? null,
    store: (x.store as string) ?? null,
    maDon: (x.ma_don as string) ?? null,
    coDonTrongHeThong: x.order_id != null,
    vendor: (x.vendor as string) ?? null,
    theoDoi: (x.theo_doi as string) ?? null,
    nguonLark: x.lark_record_id != null,
  };
}

export async function danhSachDanhGia(loc: LocDanhGia = {}): Promise<DongDanhGiaUI[]> {
  await requirePerm('view_cx_review');
  const r = await db.execute(sql`
    SELECT ${CHON}
    FROM danh_gia d LEFT JOIN stores s ON s.id = d.store_id
    WHERE (${loc.soSao ?? null}::int IS NULL OR d.so_sao = ${loc.soSao ?? null}::int)
      AND (${loc.trang ?? null}::text IS NULL OR d.trang = ${loc.trang ?? null})
      AND (${loc.trangThai ?? null}::text IS NULL OR d.trang_thai = ${loc.trangThai ?? null})
      AND (${loc.vendor ?? null}::text IS NULL OR d.vendor = ${loc.vendor ?? null})
      -- "Cần chữa" = 1–2 sao mà trạng thái chưa phải responded/archived. Trạng
      -- thái TRỐNG tính là chưa xử lý, đúng như hàm thuần daXuLy.
      AND (${loc.canChua ?? false} = false
           OR (d.so_sao <= 2 AND COALESCE(d.trang_thai, '') NOT IN ('responded', 'archived')))
    ORDER BY d.ngay DESC, d.created_at DESC
    LIMIT 500`);
  return rows<Record<string, unknown>>(r).map(doiDong);
}

export interface TongHopDanhGia {
  soCa: number;
  theoSao: NhomSao[];
  theoBrand: NhomBrand[];
  soCanChua: number;
}

/**
 * Tổng hợp. Đọc phẳng rồi gom bằng hàm thuần `tong-hop.ts`.
 *
 * KHÔNG trả sao trung bình: 22 ca 5 sao cộng 21 ca 1 sao ra ~3,0, con số không mô
 * tả gì thật.
 */
export async function tongHopDanhGia(): Promise<TongHopDanhGia> {
  await requirePerm('view_cx_review');
  const r = await db.execute(sql`SELECT id, so_sao, trang_thai, vendor FROM danh_gia`);
  const ds: DongDanhGia[] = rows<Record<string, unknown>>(r).map((x) => ({
    id: String(x.id),
    soSao: Number(x.so_sao),
    trangThai: (x.trang_thai as string) ?? null,
    vendor: (x.vendor as string) ?? null,
  }));
  return {
    soCa: ds.length,
    theoSao: gomTheoSao(ds),
    theoBrand: gomTheoBrand(ds),
    soCanChua: canChua(ds).length,
  };
}

/** Danh sách brand đang có đánh giá — cho ô lọc. */
export async function brandCoDanhGia(): Promise<string[]> {
  await requirePerm('view_cx_review');
  const r = await db.execute(sql`
    SELECT DISTINCT vendor FROM danh_gia WHERE vendor IS NOT NULL ORDER BY vendor`);
  return rows<{ vendor: string }>(r).map((x) => x.vendor);
}
