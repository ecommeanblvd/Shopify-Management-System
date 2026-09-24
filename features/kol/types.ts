/** Kiểu dùng chung cho luồng đơn KOL & chụp đồ (spec 2026-09-23). */
export type TrangThaiDon = 'nhap' | 'da_chot' | 'da_gui' | 'huy';
export type HinhThuc = 'tang' | 'muon';
/**
 * Loại NGƯỜI NHẬN. Thuộc tính của người nhận trong sổ, KHÔNG phải lựa chọn lúc
 * lên đơn — người dùng không chọn tay. Quyết định tag hiển thị và tiền tố mã
 * đơn. Thay hẳn `MucDich` cũ (CEO 24/09, migration 0162).
 */
export type LoaiNguoiNhan = 'kol' | 'ph';

export const NHAN_LOAI_NGUOI_NHAN: Record<LoaiNguoiNhan, string> = { kol: 'KOL', ph: 'PH' };

/** Tiền tố mã đơn theo loại người nhận. */
export const TIEN_TO_MA: Record<LoaiNguoiNhan, string> = { kol: 'KOL', ph: 'PH' };

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
  /** ID biến thể Shopify dạng gid đầy đủ. Đây là thứ tem `V:` mã hoá và là
   *  khoá định danh hệ thống đang chuyển sang dùng thay SKU (CEO 24/09) —
   *  120.817 biến thể có đúng 120.817 ID, không dòng nào thiếu. */
  shopifyVariantId: string | null;
  /** Tên sản phẩm ghép biến thể (vd "Áo dài lụa — M / Đỏ"), sẵn để hiển thị. */
  tenHang: string;
  /** Tồn khả dụng CỘNG DỒN qua MỌI kho — tín hiệu tổng quan lúc chọn hàng, KHÔNG
   *  thay thế `traTonKhaDung` (tồn đúng MỘT kho, tra lại sau khi chọn Kho). */
  ton: number;
  /** Tồn khả dụng TÁCH THEO KHO — bản thiết kế 24/09 hiện "AP 0 · DM 4 · GVM 12"
   *  ngay trong ô tìm, để người chọn thấy kho nào có hàng trước khi chọn dòng. */
  tonTheoKho: { kho: string; ton: number }[];
  /** Giá vốn một đơn vị; null = SKU chưa có giá trong `sku_costs`. */
  giaVon: number | null;
  giaVonTienTe: string | null;
}

/** Kết quả diễn giải một lần quét khi tạo đơn KOL — xem `features/kol/quet.ts`. */
export type KetQuaQuet =
  | { ok: true; bienThe: KetQuaBienThe }
  | { ok: false; raw: string; loi: string };
