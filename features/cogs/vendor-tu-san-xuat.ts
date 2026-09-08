import { BRAND_OWNED_STORES } from '@/features/mmp/brand-stores';

/**
 * Vendor tự sản xuất TRÊN STORE ĐA-BRAND `meanblvd` (MEAN vừa là brand vừa là
 * nhà máy) — khác `BRAND_OWNED_STORES` (store riêng: mọi line thuộc brand đó,
 * không cần xét vendor). `meanblvd` bán nhiều vendor (brand khác outsource
 * gửi PO/MTB riêng) nên phải lọc đúng vendor mới tính là hàng tự sản xuất.
 */
export const VENDOR_TU_SAN_XUAT_MEANBLVD = ['MEAN BLVD'] as const;

/**
 * THUẦN: line có phải hàng TỰ SẢN XUẤT hay không — quyết định COGS tính từ
 * `sku_costs`/Shopify "Cost per item" (cron này) hay từ bảng kê brand
 * (`bang-ke-import.ts`, hàng outsource).
 *
 * - store ∈ `BRAND_OWNED_STORES` (tinhatelier, mirermirer-official): MỌI line
 *   của store đó là tự sản xuất — không cần xét vendor.
 * - store `meanblvd`: CHỈ line có vendor ∈ `VENDOR_TU_SAN_XUAT_MEANBLVD` (so
 *   sánh không phân biệt hoa/thường, bỏ khoảng trắng đầu/cuối).
 * - store khác: false.
 */
export function laHangTuSanXuat(storeName: string, vendor: string | null): boolean {
  if (BRAND_OWNED_STORES[storeName]) return true;
  if (storeName === 'meanblvd') {
    const v = (vendor ?? '').trim().toLowerCase();
    return VENDOR_TU_SAN_XUAT_MEANBLVD.some((x) => x.toLowerCase() === v);
  }
  return false;
}
