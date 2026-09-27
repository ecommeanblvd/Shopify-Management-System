/**
 * Kiểu dùng chung của module ticket CX.
 *
 * Tách khỏi `queries.ts`/`actions.ts` vì hai file đó có `'use server'` — file
 * server action chỉ được export hàm async, nên interface phải ở đây để client
 * component import mà không kéo `@/db/client` vào bundle trình duyệt.
 */

export interface DongDonGan {
  lineId: string;
  maDon: string;
  store: string | null;
  sku: string | null;
  tenSanPham: string | null;
  bienThe: string | null;
  soLuong: number;
  khachEmail: string | null;
}

export interface PhanViec {
  id: string;
  boPhan: string;
  trangThai: string;
  nguoiPhuTrach: string | null;
  tenNguoiPhuTrach: string | null;
  xongLuc: Date | null;
}

export interface GhiChu {
  id: string;
  boPhan: string;
  noiDung: string;
  tenNguoiGhi: string | null;
  ghiHo: boolean;
  taoLuc: Date;
}

export interface DongTicket {
  id: string;
  maTicket: string;
  tieuDe: string;
  nhom: string;
  loai: string;
  boPhanNeu: string;
  trangThai: string;
  hanXuLy: string | null;
  khachEmail: string | null;
  store: string | null;
  nguon: string;
  taoLuc: Date;
  dongLuc: Date | null;
  /** Bộ phận được gán + trạng thái của từng bộ phận — để hiện nhãn ở danh sách. */
  phanViec: { boPhan: string; trangThai: string }[];
  soDong: number;
}

export interface ChiTietTicket extends DongTicket {
  maTicketCs: string | null;
  tenNguoiTao: string | null;
  phanViecDayDu: PhanViec[];
  ghiChu: GhiChu[];
  dong: DongDonGan[];
}

export interface TaoTicketVao {
  tieuDe: string;
  nhom: string;
  loai: string;
  boPhanNeu: string;
  boPhanNhan: string[];
  lineIds: string[];
  khachEmail: string | null;
  maTicketCs: string | null;
  hanXuLy: string | null;
  ghiChuDau: string | null;
}

export interface LocTicket {
  trangThai?: string;
  nhom?: string;
  boPhan?: string;
  /** true = chỉ ticket có phần việc của bộ phận CHÍNH người đang xem. */
  cuaToi?: boolean;
}
