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

/**
 * Ngưỡng số món bị BỎ QUA (unique violation, xem `sync-line-id.ts`) trong MỘT lượt mà nếu vượt
 * qua — kèm KHÔNG nối được món nào — thì coi là lỗi hệ thống, không phải vài dòng xấu rời rạc.
 *
 * Vì sao 20: một dòng dữ liệu rác lẻ tẻ hoặc một race hiếm hoi (dù đã có khoá advisory + lọc
 * trùng theo `shopifyLineId`) hiếm khi tạo ra quá một chục lần đụng unique index trong một lượt.
 * 20 đủ cao để KHÔNG báo động oan vì vài dòng thật sự xấu (savepoint đã cô lập chúng đúng như
 * thiết kế), nhưng đủ thấp để bắt một lượt hỏng TOÀN PHẦN (vd `statement_timeout` đặt quá thấp,
 * hoặc khoá tranh chấp `lark_mon_don` từ tiến trình khác khiến MỌI UPDATE trong savepoint đều
 * thất bại theo cùng một kiểu) trước khi nó lặp lại mỗi giờ mà `job_runs` vẫn báo `'ok'` xanh giả
 * (review 23/09/2026 vòng 3). Không so theo tỉ lệ trên `MOI_LUOT` (2000) vì phần lớn món trong
 * một lượt thường vốn không có ứng viên để thử ghi — 0/2000 "lần thử" là bình thường.
 */
export const NGUONG_BO_SOT_HE_THONG = 20;

/**
 * THUẦN: một lượt nối có phải "hỏng hệ thống" không.
 *
 * `noiDuoc === 0` giữa hàng chục lần thử ghi thất bại nghĩa là MỌI lần ghi đều hỏng theo cùng
 * một kiểu — khác hẳn phân bố ngẫu nhiên của vài dòng xấu (vốn xen kẽ với phần lớn ghi thành
 * công). Nếu đã nối được ít nhất một món thì unique-violation còn lại chỉ là nhiễu hàng-dòng
 * bình thường, không phải hỏng hệ thống — dù `boSot` cao.
 */
export function laLoiHeThong(noiDuoc: number, boSot: number): boolean {
  return noiDuoc === 0 && boSot >= NGUONG_BO_SOT_HE_THONG;
}

/** THUẦN: mã in vào tem — dòng đơn trước, rồi biến thể, cuối cùng mã kho tự cấp. */
export function maTemChoMon(x: { shopifyLineId?: string | null; shopifyVariantId?: string | null; unitCode?: string | null }): string | null {
  if (x.shopifyLineId) return maTemDong(x.shopifyLineId);
  if (x.shopifyVariantId) return maTemBienThe(x.shopifyVariantId);
  return x.unitCode?.trim() || null;
}
