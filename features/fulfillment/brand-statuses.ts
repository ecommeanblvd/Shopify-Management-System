/** Trạng thái dòng fulfillment nghĩa là "MMP phải sản xuất" (brand). NGUỒN DUY NHẤT
 *  — dùng chung ở mmp push/backfill, warehouse staging, fulfillment rollup. Trước
 *  đây lặp ở 4 chỗ (array/Set/inline) → dễ lệch khi thêm status mới. THUẦN. */
export const BRAND_STATUSES = ['out_of_stock', 'brand_requested', 'brand_confirmed', 'brand_rejected'] as const;

export type BrandStatus = (typeof BRAND_STATUSES)[number];

/** Dòng có thuộc nhóm brand (MMP sản xuất) không. Null/undefined → false. */
export function isBrandStatus(status: string | null | undefined): boolean {
  return status != null && (BRAND_STATUSES as readonly string[]).includes(status);
}
