import { describe, it, expect } from 'vitest';
import { scoreProducts, type CatalogProduct, type SeedSignals } from './recommend';

function p(over: Partial<CatalogProduct> & { shopifyProductId: string }): CatalogProduct {
  return {
    title: 'T', handle: 'h', vendor: null, productType: null, tags: [],
    imageUrl: null, priceMin: '10.00', currency: 'USD',
    availableForSale: true, status: 'ACTIVE', syncedAt: new Date('2026-07-01T00:00:00Z'),
    ...over,
  };
}
const seed: SeedSignals = {
  vendors: ['Nike'], productTypes: ['Shoes'], tags: ['red', 'summer'],
  excludeProductIds: ['gid://shopify/Product/1'],
};

describe('scoreProducts', () => {
  it('cùng vendor +2, cùng productType +2, mỗi tag chung +1', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/2', vendor: 'Nike', productType: 'Shoes', tags: ['red', 'summer'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(6); // 2 + 2 + 1 + 1
  });
  it('loại excludeProductIds (seed sản phẩm)', () => {
    const r = scoreProducts(seed, [p({ shopifyProductId: 'gid://shopify/Product/1', vendor: 'Nike' })]);
    expect(r).toHaveLength(0);
  });
  it('loại !availableForSale, status != ACTIVE, và điểm 0', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/3', vendor: 'Nike', availableForSale: false }),
      p({ shopifyProductId: 'gid://shopify/Product/4', vendor: 'Nike', status: 'DRAFT' }),
      p({ shopifyProductId: 'gid://shopify/Product/5', vendor: 'Adidas', productType: 'Hat', tags: [] }), // điểm 0
    ]);
    expect(r).toHaveLength(0);
  });
  it('tie-break: syncedAt mới hơn đứng trước', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/6', vendor: 'Nike', syncedAt: new Date('2026-07-01T00:00:00Z') }),
      p({ shopifyProductId: 'gid://shopify/Product/7', vendor: 'Nike', syncedAt: new Date('2026-07-05T00:00:00Z') }),
    ]);
    expect(r.map((x) => x.shopifyProductId)).toEqual(['gid://shopify/Product/7', 'gid://shopify/Product/6']);
  });
  it('mặc định top 8, override topN', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      p({ shopifyProductId: `gid://shopify/Product/1${i}`, vendor: 'Nike' }));
    expect(scoreProducts(seed, many)).toHaveLength(8);
    expect(scoreProducts(seed, many, 3)).toHaveLength(3);
  });
  it('sort điểm giảm dần', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/8', vendor: 'Nike' }),                 // +2
      p({ shopifyProductId: 'gid://shopify/Product/9', vendor: 'Nike', productType: 'Shoes' }), // +4
    ]);
    expect(r.map((x) => x.score)).toEqual([4, 2]);
  });
  it('case-insensitive: seed tag "red" matches candidate "Red " (uppercase + space)', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/10', tags: ['Red '] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(1);
  });
  it('case-insensitive: seed vendor "Nike" matches candidate "NIKE" (uppercase)', () => {
    const seedUpper = { ...seed, vendors: ['MEAN BLVD'], productTypes: [], tags: [] };
    const r = scoreProducts(seedUpper, [
      p({ shopifyProductId: 'gid://shopify/Product/11', vendor: 'mean blvd' }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(2);
  });
  it('dedupe: candidate tags ["red","Red","RED"] with seed tag "red" scores +1 not +3', () => {
    const r = scoreProducts(seed, [
      p({ shopifyProductId: 'gid://shopify/Product/12', tags: ['red', 'Red', 'RED'] }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(1);
  });
});
