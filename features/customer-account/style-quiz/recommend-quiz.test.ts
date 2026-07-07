import { describe, it, expect } from 'vitest';
import { scoreProduct, recommendForProfile, colorScore, bodyScore, archetypeScore } from './recommend-quiz';
import { extractProductAttributes } from './extract';
import { deriveProfile, type StyleProfile } from './profile';
import type { CatalogProduct } from '../recommend';

function prod(over: Partial<CatalogProduct> & { title: string; shopifyProductId: string }): CatalogProduct {
  return {
    handle: 'h', vendor: 'Cici', productType: null, tags: [], imageUrl: 'x',
    priceMin: '100', currency: 'VND', availableForSale: true, status: 'ACTIVE',
    syncedAt: new Date('2026-07-01'), ...over,
  };
}

// Winter + hourglass + romantic
const profile: StyleProfile = deriveProfile({
  color: { whiteVsCream: -1, jewelry: -1, skinDepth: 1, hairDepth: 1, vividVsDusty: 1, eyesClearSoft: 1 },
  archetype: { q1_dinner: 'floral', q6_lookas: 'pretty', q5_fabric: 'chiffon' },
  body: { measurements: { bust: 36, waist: 26, hips: 37 } },
}, { refined: true });

describe('sub-scores', () => {
  it('color: family match scores high, unknown → null', () => {
    const black = extractProductAttributes(prod({ shopifyProductId: '1', title: 'Black Dress', tags: ['Black'] }));
    expect(colorScore(profile, black)).toBe(0.9); // black → Winter, profile Winter
    const noColor = extractProductAttributes(prod({ shopifyProductId: '2', title: 'Plain Skort', productType: 'Skorts' }));
    expect(colorScore(profile, noColor)).toBeNull();
  });
  it('body: flattering silhouette boosts, unknown → null', () => {
    const wrap = extractProductAttributes(prod({ shopifyProductId: '3', title: 'Sweetheart Wrap Dress' }));
    expect(bodyScore(profile, wrap)).toBeGreaterThan(0.6); // hourglass loves wrap + sweetheart
    const bare = extractProductAttributes(prod({ shopifyProductId: '4', title: 'Something', tags: [] }));
    expect(bodyScore(profile, bare)).toBeNull();
  });
  it('archetype: mood hit boosts, no mood → null', () => {
    const romantic = extractProductAttributes(prod({ shopifyProductId: '5', title: 'Floral Lace Dress' }));
    expect(archetypeScore(profile, romantic)).toBeGreaterThanOrEqual(0.7);
  });
});

describe('scoreProduct — unknowns are neutral, not penalized', () => {
  it('a fully-matching product outscores a fully-clashing one', () => {
    const match = extractProductAttributes(prod({ shopifyProductId: '10', title: 'Noelle Sweetheart Wrap Dress Lace', tags: ['Black'] }));
    const clash = extractProductAttributes(prod({ shopifyProductId: '11', title: 'Mustard Oversized Shift', tags: ['Mustard'], productType: 'Dress' }));
    expect(scoreProduct(profile, match)).toBeGreaterThan(scoreProduct(profile, clash));
  });
  it('a product with NO extractable attributes scores ~neutral (≈0.5), not 0', () => {
    const blank = extractProductAttributes(prod({ shopifyProductId: '12', title: 'Xyzzy', tags: [] }));
    const s = scoreProduct(profile, blank);
    expect(s).toBeGreaterThan(0.4);
    expect(s).toBeLessThan(0.6);
  });
});

describe('recommendForProfile — ranking + diversity', () => {
  const many: CatalogProduct[] = [
    ...Array.from({ length: 10 }, (_, i) => prod({ shopifyProductId: `d${i}`, title: `Black Sweetheart Wrap Dress ${i}`, productType: 'Dress', tags: ['Black'] })),
    prod({ shopifyProductId: 't1', title: 'Black Scoop Top', productType: 'Top', tags: ['Black'] }),
    prod({ shopifyProductId: 'b1', title: 'Black Pencil Skirt', productType: 'Skirt', tags: ['Black'] }),
    prod({ shopifyProductId: 'o1', title: 'Black Tailored Blazer', productType: 'Blazer', tags: ['Black'] }),
  ];

  it('caps one category so results are not all dresses', () => {
    const recs = recommendForProfile(profile, many, { topN: 8 });
    const dresses = recs.filter((r) => r.attrs.category === 'dress').length;
    expect(dresses).toBeLessThanOrEqual(2); // cap = ceil(8/4) = 2
    const cats = new Set(recs.map((r) => r.attrs.category));
    expect(cats.size).toBeGreaterThan(1); // diverse
  });

  it('excludes unavailable / archived / excluded products', () => {
    const list = [
      prod({ shopifyProductId: 'a', title: 'Black Wrap Dress', tags: ['Black'], availableForSale: false }),
      prod({ shopifyProductId: 'b', title: 'Black Wrap Dress', tags: ['Black'], status: 'ARCHIVED' }),
      prod({ shopifyProductId: 'c', title: 'Black Wrap Dress', tags: ['Black'] }),
    ];
    const recs = recommendForProfile(profile, list, { topN: 8, excludeProductIds: ['c'] });
    expect(recs).toHaveLength(0); // a unavailable, b archived, c excluded
  });

  it('attaches human-readable reasons for matched picks', () => {
    const recs = recommendForProfile(profile, [prod({ shopifyProductId: 'x', title: 'Black Sweetheart Wrap Lace Dress', tags: ['Black'] })], { topN: 4 });
    expect(recs[0].reasons.length).toBeGreaterThan(0);
  });
});
