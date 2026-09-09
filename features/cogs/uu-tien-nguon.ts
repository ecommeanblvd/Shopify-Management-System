/**
 * THUẦN: thứ tự ưu tiên NGUỒN giá vốn một dòng `order_line_cogs` (spec §7 refined —
 * quyết định cuối 2026-09-08, thay cho "ngang hàng ưu tiên, không đè lên nhau" ban đầu):
 *
 *   `mmp` KẾ NHIỆM `brand_statement` — MMP thay thế hoàn toàn quy trình bảng kê xlsx tay,
 *   nên dòng `mmp` luôn được ghi đè lên dòng `brand_statement` (và ngược lại thì KHÔNG —
 *   sheet import lại một kỳ cũ không được xoá số đã lên MMP). Cả hai nguồn "bảng kê"
 *   (`brand_statement`, `mmp`) đều đè `shopify_unit_cost` (ưu tiên THẤP NHẤT — Cost per
 *   item Shopify chỉ là số tạm khi chưa có đối soát brand). `shopify_unit_cost` không bao
 *   giờ đè nguồn nào khác (thực thi ở `own-cogs.ts` qua `onConflictDoNothing`, không dùng
 *   hàm này).
 */
export type Source = 'brand_statement' | 'mmp' | 'shopify_unit_cost' | 'po';

/** Số càng lớn, ưu tiên càng cao. */
const THU_TU: Record<Source, number> = {
  shopify_unit_cost: 0,
  brand_statement: 1,
  /** Phân bổ từ PO (hàng MEAN mua đứt, kê #MBLVDPO/#MTB) — cùng gốc bảng kê brand nên ngang `brand_statement`; `mmp` kế nhiệm cả hai. */
  po: 1,
  mmp: 2,
};

/**
 * Dòng đang có nguồn `hienTai` có được ghi đè bởi dòng nguồn `moi` hay không.
 * Cùng nguồn → luôn được (ghi lại/cập nhật chính nguồn đó, ví dụ nhập lại một
 * kỳ sheet cũ). Khác nguồn → chỉ khi `moi` ưu tiên CAO HƠN `hienTai`.
 */
/** Thứ tự ưu tiên của một nguồn (−1 nếu không biết) — dùng khi một dòng đơn có nhiều dòng giá vốn (chọn nguồn cao nhất). */
export function uuTienNguon(s: string): number { return THU_TU[s as Source] ?? -1; }

export function duocGhiDe(hienTai: Source, moi: Source): boolean {
  if (hienTai === moi) return true;
  return THU_TU[moi] > THU_TU[hienTai];
}
