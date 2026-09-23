/** Kiểu dùng chung cho luồng đơn KOL & chụp đồ (spec 2026-09-23). */
export type TrangThaiDon = 'nhap' | 'da_chot' | 'da_gui' | 'huy';
export type HinhThuc = 'tang' | 'muon';
export type MucDich = 'kol' | 'chup_do' | 'khac';

/** Một dòng hàng, đủ để tính chi phí và tình trạng mượn — không dính DB. */
export interface DongDon {
  id: string;
  sku: string;
  tenHang: string | null;
  kho: string;
  soLuong: number;
  hinhThuc: HinhThuc;
  hanTra: string | null;
  /** numeric của Postgres về TS là string; null khi chưa có giá. */
  giaVon: string | null;
  giaVonTienTe: string | null;
  soLuongDaTra: number;
  soLuongNhapLai: number;
}

/**
 * Một kết quả tìm kiếm/quét biến thể — dùng cho picker "Mã hàng" khi tạo đơn
 * KOL (modal, rebuild 23/09/2026). Bao trùm TOÀN BỘ biến thể Shopify (kể cả
 * chưa có hàng), không chỉ SKU đang có tồn kho.
 */
export interface KetQuaBienThe {
  sku: string;
  /** Tên sản phẩm ghép biến thể (vd "Áo dài lụa — M / Đỏ"), sẵn để hiển thị. */
  tenHang: string;
  /** Tồn khả dụng CỘNG DỒN qua MỌI kho — tín hiệu tổng quan lúc chọn hàng, KHÔNG
   *  thay thế `traTonKhaDung` (tồn đúng MỘT kho, tra lại sau khi chọn Kho). */
  ton: number;
}

/** Kết quả diễn giải một lần quét khi tạo đơn KOL — xem `features/kol/quet.ts`. */
export type KetQuaQuet =
  | { ok: true; bienThe: KetQuaBienThe }
  | { ok: false; raw: string; loi: string };
