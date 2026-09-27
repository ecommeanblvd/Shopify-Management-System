/**
 * Kiểu dùng chung của module tranh chấp.
 *
 * Tách khỏi `queries.ts`/`actions.ts` vì hai file đó có `'use server'` — file
 * server action chỉ được export hàm async.
 */

export interface DongDispute {
  id: string;
  store: string;
  storeId: string;
  nguon: string;
  shopifyDisputeId: string | null;
  maHoSo: string | null;
  congThanhToan: string | null;
  loai: string;
  trangThai: string;
  lyDo: string | null;
  lyDoMang: string | null;
  soTien: string;
  tienTe: string;
  phiDispute: string | null;
  moLuc: Date | null;
  hanNop: Date | null;
  daNopLuc: Date | null;
  chotLuc: Date | null;
  maDon: string | null;
  /** Có nối được sang đơn trong hệ thống hay không — chỉ ~28% ca cũ nối được. */
  coDonTrongHeThong: boolean;
  khachEmail: string | null;
  soGhiChu: number;
}

export interface GhiChuDispute {
  id: string;
  noiDung: string;
  tenNguoiGhi: string | null;
  tuLark: boolean;
  taoLuc: Date;
}

export interface ChiTietDispute extends DongDispute {
  ghiChu: GhiChuDispute[];
  dongBoLuc: Date | null;
}

export interface LocDispute {
  storeId?: string;
  cong?: string;
  trangThai?: string;
  nguon?: string;
  /** true = chỉ ca còn phải làm (needs_response / under_review). */
  dangMo?: boolean;
}

export interface NhapDisputeVao {
  storeId: string;
  congThanhToan: string;
  maHoSo: string | null;
  trangThai: string;
  lyDo: string | null;
  soTien: string;
  tienTe: string;
  phiDispute: string | null;
  moLuc: string | null;
  hanNop: string | null;
  maDon: string | null;
  khachEmail: string | null;
  ghiChu: string | null;
}
