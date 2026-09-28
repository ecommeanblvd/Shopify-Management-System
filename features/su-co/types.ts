/**
 * Kiểu dùng chung của module sự cố. Tách khỏi `queries.ts`/`actions.ts` vì hai
 * file đó có `'use server'` — chỉ được export hàm async.
 */

export interface ChiPhi {
  id: string;
  loai: string;
  soTien: string;
  tienTe: string;
  /** null = thừa hưởng bộ phận chính của sự cố. */
  boPhan: string | null;
}

export interface GhiChuSuCo {
  id: string;
  noiDung: string;
  tenNguoiGhi: string | null;
  tuLark: boolean;
  taoLuc: Date;
}

export interface DongSuCo {
  id: string;
  maSuCo: string;
  ngayBao: string;
  nguyenNhan: string;
  giaiDoan: string | null;
  trangThai: string;
  moTa: string | null;
  boPhanChinh: string | null;
  maGiamGia: string | null;
  maTicketCs: string | null;
  store: string | null;
  maDon: string | null;
  coDonTrongHeThong: boolean;
  canXemLai: boolean;
  nguonLark: boolean;
  soAnh: number;
  chiPhi: ChiPhi[];
}

export interface ChiTietSuCo extends DongSuCo {
  anhUrls: string[];
  ghiChu: GhiChuSuCo[];
  tenNguoiTao: string | null;
  taoLuc: Date;
  dongLuc: Date | null;
}

export interface ChiPhiVao {
  loai: string;
  soTien: string;
  tienTe: string;
  boPhan: string | null;
}

export interface GhiSuCoVao {
  ngayBao: string;
  nguyenNhan: string;
  giaiDoan: string | null;
  moTa: string | null;
  boPhanChinh: string | null;
  maGiamGia: string | null;
  maTicketCs: string | null;
  maDon: string | null;
  chiPhi: ChiPhiVao[];
  anhKeys: string[];
}

export interface LocSuCo {
  trangThai?: string;
  nguyenNhan?: string;
  boPhan?: string;
  canXemLai?: boolean;
}
