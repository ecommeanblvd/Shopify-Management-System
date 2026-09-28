/** Kiểu dùng chung của module đánh giá. Tách khỏi file `'use server'`. */

export interface DongDanhGiaUI {
  id: string;
  maDanhGia: string;
  ngay: string;
  soSao: number;
  trang: string | null;
  noiDung: string | null;
  ghiChuCx: string | null;
  trangThai: string | null;
  kenhLienHe: string | null;
  quocGia: string | null;
  khachEmail: string | null;
  khachTen: string | null;
  store: string | null;
  maDon: string | null;
  coDonTrongHeThong: boolean;
  vendor: string | null;
  theoDoi: string | null;
  nguonLark: boolean;
}

export interface GhiDanhGiaVao {
  ngay: string;
  soSao: number;
  trang: string | null;
  noiDung: string | null;
  ghiChuCx: string | null;
  trangThai: string | null;
  kenhLienHe: string | null;
  quocGia: string | null;
  khachEmail: string | null;
  khachTen: string | null;
  maDon: string | null;
  vendor: string | null;
  theoDoi: string | null;
}

export interface LocDanhGia {
  soSao?: number;
  trang?: string;
  trangThai?: string;
  vendor?: string;
  /** true = chỉ đánh giá 1–2 sao chưa xử lý. */
  canChua?: boolean;
}
