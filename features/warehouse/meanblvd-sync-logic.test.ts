import { describe, it, expect } from 'vitest';
import {
  normSku,
  planMeanblvdSync,
  type MeanProduct,
} from './meanblvd-sync-logic';

function variant(over: Partial<MeanProduct['variants'][number]> = {}) {
  return {
    sku: 'ABC',
    inventoryQuantity: 0,
    inventoryItemId: 'gid://shopify/InventoryItem/1',
    tracked: true,
    ...over,
  };
}

function product(over: Partial<MeanProduct> = {}): MeanProduct {
  return {
    id: 'gid://shopify/Product/1',
    status: 'ACTIVE',
    variants: [variant()],
    ...over,
  };
}

describe('normSku', () => {
  it('trims, uppercases', () => {
    expect(normSku('  abc ')).toBe('ABC');
  });

  it('strips a -SALE suffix (case-insensitive)', () => {
    expect(normSku('X-Sale')).toBe('X');
    expect(normSku('x-SALE')).toBe('X');
  });

  it('strips a -PLA suffix', () => {
    expect(normSku('X-PLA')).toBe('X');
  });

  it('collapses stacked suffixes (applied twice)', () => {
    expect(normSku('X-PLA-SALE')).toBe('X');
    expect(normSku('X-SALE-PLA')).toBe('X');
  });

  it('leaves an interior "-SALE" that is not a suffix alone', () => {
    expect(normSku('X-SALE-Y')).toBe('X-SALE-Y');
  });
});

describe('planMeanblvdSync — inventory sets', () => {
  it('emits a set only when target differs from current', () => {
    const products = [
      product({
        variants: [
          variant({ sku: 'A', inventoryItemId: 'ii/A', inventoryQuantity: 3 }), // target 5 → set
          variant({ sku: 'B', inventoryItemId: 'ii/B', inventoryQuantity: 2 }), // target 2 → no-op
        ],
      }),
    ];
    const sellable = new Map([
      ['A', 5],
      ['B', 2],
    ]);
    const plan = planMeanblvdSync(products, sellable);
    expect(plan.inventorySets).toEqual([{ inventoryItemId: 'ii/A', quantity: 5 }]);
  });

  it('sets 0 when the SKU is absent from the warehouse map', () => {
    const products = [
      product({
        status: 'DRAFT', // avoid archive noise; focus on the set
        variants: [variant({ sku: 'GHOST', inventoryItemId: 'ii/G', inventoryQuantity: 4 })],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map());
    expect(plan.inventorySets).toEqual([{ inventoryItemId: 'ii/G', quantity: 0 }]);
  });

  it('clamps negative sellable to 0', () => {
    const products = [
      product({
        status: 'DRAFT',
        variants: [variant({ sku: 'A', inventoryItemId: 'ii/A', inventoryQuantity: 10 })],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map([['A', -7]]));
    expect(plan.inventorySets).toEqual([{ inventoryItemId: 'ii/A', quantity: 0 }]);
  });
});

describe('planMeanblvdSync — SKU normalization matching', () => {
  it('matches warehouse "X-PLA" ↔ Shopify "X"', () => {
    const products = [
      product({
        status: 'DRAFT',
        variants: [variant({ sku: 'X', inventoryItemId: 'ii/X', inventoryQuantity: 0 })],
      }),
    ];
    // Warehouse key is normalized upstream in the orchestrator; here we assert
    // that the Shopify-side "X" collapses to the same normSku the warehouse
    // "X-PLA" would produce.
    expect(normSku('X-PLA')).toBe(normSku('X'));
    const sellable = new Map([[normSku('X-PLA'), 9]]);
    const plan = planMeanblvdSync(products, sellable);
    expect(plan.inventorySets).toEqual([{ inventoryItemId: 'ii/X', quantity: 9 }]);
  });

  it('matches warehouse "X-PLA" ↔ Shopify "X-Sale" (both collapse)', () => {
    expect(normSku('X-PLA')).toBe(normSku('X-Sale'));
    const products = [
      product({
        status: 'DRAFT',
        variants: [variant({ sku: 'X-Sale', inventoryItemId: 'ii/XS', inventoryQuantity: 0 })],
      }),
    ];
    const sellable = new Map([[normSku('X-PLA'), 4]]);
    const plan = planMeanblvdSync(products, sellable);
    expect(plan.inventorySets).toEqual([{ inventoryItemId: 'ii/XS', quantity: 4 }]);
  });
});

describe('planMeanblvdSync — status transitions', () => {
  it('archives an ACTIVE product whose variants all end at 0', () => {
    const products = [
      product({
        id: 'p/act-zero',
        status: 'ACTIVE',
        variants: [
          variant({ sku: 'A', inventoryItemId: 'ii/A', inventoryQuantity: 0 }),
          variant({ sku: 'B', inventoryItemId: 'ii/B', inventoryQuantity: 0 }),
        ],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map());
    expect(plan.archive).toEqual(['p/act-zero']);
    expect(plan.unarchive).toEqual([]);
  });

  it('un-archives an ARCHIVED product that now has stock on any variant', () => {
    const products = [
      product({
        id: 'p/arch-stock',
        status: 'ARCHIVED',
        variants: [
          variant({ sku: 'A', inventoryItemId: 'ii/A', inventoryQuantity: 0 }),
          variant({ sku: 'B', inventoryItemId: 'ii/B', inventoryQuantity: 0 }),
        ],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map([['B', 3]]));
    expect(plan.unarchive).toEqual(['p/arch-stock']);
    expect(plan.archive).toEqual([]);
  });

  it('does not change status of an ACTIVE product that has stock', () => {
    const products = [
      product({
        id: 'p/act-stock',
        status: 'ACTIVE',
        variants: [variant({ sku: 'A', inventoryItemId: 'ii/A', inventoryQuantity: 5 })],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map([['A', 5]]));
    expect(plan.archive).toEqual([]);
    expect(plan.unarchive).toEqual([]);
  });

  it('does not touch DRAFT status even when all zero', () => {
    const products = [
      product({
        id: 'p/draft',
        status: 'DRAFT',
        variants: [variant({ sku: 'A', inventoryItemId: 'ii/A', inventoryQuantity: 2 })],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map());
    expect(plan.archive).toEqual([]);
    expect(plan.unarchive).toEqual([]);
    // still emits the inventory set to 0
    expect(plan.inventorySets).toEqual([{ inventoryItemId: 'ii/A', quantity: 0 }]);
  });

  it('never archives a product with no tracked/sku variants', () => {
    const products = [
      product({
        id: 'p/untracked',
        status: 'ACTIVE',
        variants: [
          variant({ sku: 'A', tracked: false, inventoryQuantity: 0 }),
          variant({ sku: '', tracked: true, inventoryQuantity: 0 }),
          variant({ sku: '   ', tracked: true, inventoryQuantity: 0 }),
        ],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map());
    expect(plan.archive).toEqual([]);
    expect(plan.unarchive).toEqual([]);
    expect(plan.inventorySets).toEqual([]);
  });

  it('ignores untracked/empty variants when deciding allZero', () => {
    // One considered variant with stock → NOT archived, even though an
    // untracked variant is at 0.
    const products = [
      product({
        id: 'p/mixed',
        status: 'ACTIVE',
        variants: [
          variant({ sku: 'A', tracked: true, inventoryItemId: 'ii/A', inventoryQuantity: 5 }),
          variant({ sku: 'B', tracked: false, inventoryItemId: 'ii/B', inventoryQuantity: 0 }),
        ],
      }),
    ];
    const plan = planMeanblvdSync(products, new Map([['A', 5]]));
    expect(plan.archive).toEqual([]);
    // untracked variant B produces no inventory set
    expect(plan.inventorySets).toEqual([]);
  });
});
