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

/**
 * THUẦN: bỏ trùng danh sách dòng đơn theo `shopifyLineId`, giữ bản gặp đầu tiên.
 *
 * Vì sao cần: nguồn `shopify_order_lines` lẽ ra một `shopifyLineId` chỉ xuất hiện một lần cho
 * một đơn, nhưng nếu đồng bộ Shopify từng lỗi và để lọt hai dòng trùng id, `chonDongChoMon` có
 * thể chọn CÙNG một id cho hai món khác nhau trong cùng lượt (mỗi bản trùng đều "chưa ai dùng").
 * Lọc trùng trước khi đưa vào `chonDongChoMon` chặn việc đó ngay từ khâu chọn ứng viên, trước cả
 * khi chạm DB — lưới an toàn tầng DB (unique index `lark_mon_don_line_uniq`) vẫn giữ nguyên bên
 * dưới phòng khi hai tiến trình cùng lượt (xem `sync-line-id.ts`).
 */
export function locTrungTheoLineId<T extends { shopifyLineId: string }>(dsDong: readonly T[]): T[] {
  const daGap = new Set<string>();
  const ket: T[] = [];
  for (const d of dsDong) {
    if (daGap.has(d.shopifyLineId)) continue;
    daGap.add(d.shopifyLineId);
    ket.push(d);
  }
  return ket;
}

/** THUẦN: mã in vào tem — dòng đơn trước, rồi biến thể, cuối cùng mã kho tự cấp. */
export function maTemChoMon(x: { shopifyLineId?: string | null; shopifyVariantId?: string | null; unitCode?: string | null }): string | null {
  if (x.shopifyLineId) return maTemDong(x.shopifyLineId);
  if (x.shopifyVariantId) return maTemBienThe(x.shopifyVariantId);
  return x.unitCode?.trim() || null;
}
