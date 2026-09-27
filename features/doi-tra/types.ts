/**
 * Kiểu dùng chung của module đổi trả.
 *
 * Tách khỏi `queries.ts`/`actions.ts` vì hai file đó có `'use server'`: file
 * server action CHỈ được export hàm async, nên interface phải ở đây để client
 * component import mà không kéo theo `@/db/client` vào bundle trình duyệt.
 */

export interface DongDonTra {
  lineId: string;
  orderId: string;
  storeId: string;
  maDon: string;
  store: string | null;
  sku: string | null;
  tenSanPham: string | null;
  bienThe: string | null;
  soLuong: number;
  donGia: string;
  khachEmail: string | null;
  khachTen: string | null;
  /** Số món của dòng này ĐÃ có yêu cầu trả — chặn tạo trùng. */
  daTra: number;
}

export interface TaoYeuCauVao {
  lineId: string;
  soLuong: number;
  lyDoChinh: string;
  lyDoPhu: string | null;
  noiHoan: string;
  loai: string;
  ghiChu: string | null;
}
