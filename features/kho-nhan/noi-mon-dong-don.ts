/**
 * Nối MÓN trên Lark với DÒNG ĐƠN Shopify, và chọn mã in vào tem.
 *
 * Vì sao cần: tem dán lên hàng về theo đơn mang mã dòng đơn, nên phải biết món ấy là dòng nào.
 * Đơn có thể mua hai cái giống hệt (thật: #MBLVD29928 × SemiSense-TM26-D20-L-WADM-PLA) nên
 * nối theo mã hàng thôi là nhập nhằng — phải "dòng nào chưa ai dùng thì lấy".
 */
import { maTemDong, maTemBienThe } from '@/features/receiving/ma-tem';

export interface DongDonToiThieu {
  shopifyLineId: string;
  sku: string | null;
  /** Đã gán cho một món khác trong lượt nối này. */
  daDung: boolean;
}

/** THUẦN: chọn dòng đơn cho một món. Hết dòng chưa dùng → null, KHÔNG gán trùng. */
export function chonDongChoMon(sku: string | null, dsDong: readonly DongDonToiThieu[]): string | null {
  const s = sku?.trim();
  if (!s) return null;
  return dsDong.find((d) => d.sku?.trim() === s && !d.daDung)?.shopifyLineId ?? null;
}

/** THUẦN: mã in vào tem — dòng đơn trước, rồi biến thể, cuối cùng mã kho tự cấp. */
export function maTemChoMon(x: { shopifyLineId?: string | null; shopifyVariantId?: string | null; unitCode?: string | null }): string | null {
  if (x.shopifyLineId) return maTemDong(x.shopifyLineId);
  if (x.shopifyVariantId) return maTemBienThe(x.shopifyVariantId);
  return x.unitCode?.trim() || null;
}
