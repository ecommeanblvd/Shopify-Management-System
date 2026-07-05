/** THUẦN: recommendation engine rule-based (spec 2026-07-05-wishlist-page §5).
 *  NƠI DUY NHẤT tính điểm gợi ý sản phẩm — tái dùng cho sub-project C (Style Quiz).
 *  Điểm: cùng vendor +2, cùng productType +2, mỗi tag chung +1. Loại: seed, !availableForSale,
 *  status != ACTIVE, điểm 0. Trả top N (mặc định 8), tie-break syncedAt mới hơn trước. */

export interface CatalogProduct {
  shopifyProductId: string;
  title: string;
  handle: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  imageUrl: string | null;
  priceMin: string | null;
  currency: string | null;
  availableForSale: boolean;
  status: string;
  syncedAt: Date;
}
export interface SeedSignals {
  vendors: string[];
  productTypes: string[];
  tags: string[];
  excludeProductIds: string[];
}
export interface ScoredProduct extends CatalogProduct { score: number; }

const DEFAULT_TOP_N = 8;

export function scoreProducts(seed: SeedSignals, candidates: CatalogProduct[], topN = DEFAULT_TOP_N): ScoredProduct[] {
  const vendorSet = new Set(seed.vendors.filter(Boolean));
  const typeSet = new Set(seed.productTypes.filter(Boolean));
  const tagSet = new Set(seed.tags.filter(Boolean));
  const excludeSet = new Set(seed.excludeProductIds);

  const scored: ScoredProduct[] = [];
  for (const c of candidates) {
    if (excludeSet.has(c.shopifyProductId)) continue;
    if (!c.availableForSale) continue;
    if (c.status !== 'ACTIVE') continue;
    let score = 0;
    if (c.vendor && vendorSet.has(c.vendor)) score += 2;
    if (c.productType && typeSet.has(c.productType)) score += 2;
    for (const t of c.tags) if (tagSet.has(t)) score += 1;
    if (score === 0) continue;
    scored.push({ ...c, score });
  }
  scored.sort((a, b) => b.score - a.score || b.syncedAt.getTime() - a.syncedAt.getTime());
  return scored.slice(0, topN);
}
