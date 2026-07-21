/**
 * Store RIÊNG của brand (MEAN vận hành hộ): MỌI đơn của store thuộc về brand đó
 * — push sang MMP không cần đơn phải có dòng phân bổ brand (khác store đa-brand
 * meanblvd/cici nơi chỉ dòng brand_requested/received mới thuộc brand).
 *
 * Key = stores.name; vendor = chuỗi vendor MMP dùng để route về brand (fallback
 * khi line thiếu vendor).
 */
export const BRAND_OWNED_STORES: Record<string, { vendor: string; brandSlug: string }> = {
  tinhatelier: { vendor: 'TINH Atelier', brandSlug: 'tinh' }, // slug MMP đổi 18/06 (tinh-atelier cũ archived)
  'mirermirer-official': { vendor: 'Mirer', brandSlug: 'mirer' },
};

export function brandOwnedStore(storeName: string | null | undefined) {
  return storeName ? BRAND_OWNED_STORES[storeName] ?? null : null;
}
