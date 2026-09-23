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
