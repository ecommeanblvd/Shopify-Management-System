import { BRAND_OWNED_STORES } from '@/features/mmp/brand-stores';

/**
 * Vendor tự sản xuất TRÊN STORE ĐA-BRAND `meanblvd` (MEAN vừa là brand vừa là
 * nhà máy) — khác `BRAND_OWNED_STORES` (store riêng: mọi line thuộc brand đó,
 * không cần xét vendor). `meanblvd` bán nhiều vendor (brand khác outsource
 * gửi PO/MTB riêng) nên phải lọc đúng vendor mới tính là hàng tự sản xuất.
 */
export const VENDOR_TU_SAN_XUAT_MEANBLVD = ['MEAN BLVD'] as const;

/** Danh sách store tự sản xuất (nguồn sự thật duy nhất — dùng ở `own-cogs.ts`
 *  và `unit-cost-sync.ts`, thay vì mỗi nơi tự khai lại `[...Object.keys(BRAND_OWNED_STORES), 'meanblvd']`). */
export const STORE_TU_SAN_XUAT = [...Object.keys(BRAND_OWNED_STORES), 'meanblvd'];

/**
 * `mmp_brands.slug` của MEAN khi tự sản xuất — PHẢI khớp đúng slug thật trong
 * bảng `mmp_brands` (không phải `'meanblvd'`, đó là `stores.name`). Xem test
 * guard trong `vendor-tu-san-xuat.test.ts`.
 */
export const BRAND_SLUG_MEANBLVD = 'mean-blvd';

/**
 * THUẦN: brandSlug (`mmp_brands.slug`) để ghi `order_line_cogs.brand_slug` cho
 * hàng tự sản xuất — store riêng brand (`BRAND_OWNED_STORES`) dùng đúng slug
 * của brand đó; store đa-brand `meanblvd` (vendor MEAN BLVD tự sản xuất) dùng
 * `BRAND_SLUG_MEANBLVD`.
 */
export function brandSlugTuSanXuat(storeName: string): string {
  return BRAND_OWNED_STORES[storeName]?.brandSlug ?? BRAND_SLUG_MEANBLVD;
}

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
