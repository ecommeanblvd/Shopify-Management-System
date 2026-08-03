/**
 * Store RIÊNG của brand (MEAN vận hành hộ): MỌI đơn của store thuộc về brand đó
 * — push sang MMP không cần đơn phải có dòng phân bổ brand (khác store đa-brand
 * meanblvd/cici nơi chỉ dòng brand_requested/received mới thuộc brand).
 *
 * Key = stores.name; vendor = chuỗi vendor MMP dùng để route về brand (fallback
 * khi line thiếu vendor).
 */
export interface BrandOwnedStore {
  vendor: string;
  brandSlug: string;
  /** Gửi MMP CHI PHÍ SHIP thực của đơn (cước carrier từ bill, VND) cộng phí
   *  đóng gói/xử lý INS ($/đơn) — CEO 03/08, hiện chỉ TA. Vắng = không gửi. */
  shipCost?: { insHandlingUsd: number; fxVndPerUsd: number };
}

export const BRAND_OWNED_STORES: Record<string, BrandOwnedStore> = {
  tinhatelier: {
    vendor: 'TINH Atelier', brandSlug: 'tinh', // slug MMP đổi 18/06 (tinh-atelier cũ archived)
    shipCost: { insHandlingUsd: 5, fxVndPerUsd: 26_000 }, // fx khớp account FedEx (cost VND ↔ display USD)
  },
  'mirermirer-official': { vendor: 'Mirer', brandSlug: 'mirer' },
};

export function brandOwnedStore(storeName: string | null | undefined) {
  return storeName ? BRAND_OWNED_STORES[storeName] ?? null : null;
}
