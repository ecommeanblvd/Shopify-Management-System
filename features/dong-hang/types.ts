import type { CarrierQuoteRow } from '@/features/carrier-rates/compare/quote-order-carriers';
export type BoLocDongHang = 'chua_tracking' | 'hom_nay' | '7_ngay' | 'tat_ca';
export const BO_LOC: readonly BoLocDongHang[] = ['chua_tracking', 'hom_nay', '7_ngay', 'tat_ca'];
export interface KienDongHang {
  shipmentId: string; orderId: string; orderNumber: string; storeName: string; country: string | null;
  weightKg: number | null; dims: { l: number; w: number; h: number | null } | null;
  hop: string | null; skuText: string | null; pieces: number | null;
  trackingNumber: string | null; hangKhachTra: string | null;
  selectedCarrierKey: string | null; selectedCarrierBy: string | null; selectedCarrierAt: string | null;
  /** ISO — coalesce(label_created_at, created_at). */
  ngayDong: string;
  soKienCungDon: number;
}
export interface KienChoKhop {
  recordId: string; logUniqueCode: string | null; orderNumber: string | null; weightKg: number | null;
  dims: string | null; hop: string | null; skuText: string | null; pieces: number | null; lyDo: string; nhanLuc: string;
}
export interface BaoGiaKien { rows: CarrierQuoteRow[]; reNhatKey: string | null; error?: string; luc: string }
export type TrangThaiKien =
  | { ma: 'cho_chon' }
  | { ma: 'da_chon'; hang: string; nguoi: string | null; luc: string | null }
  | { ma: 'da_len_nhan'; tracking: string };
