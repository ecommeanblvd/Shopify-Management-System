import { describe, it, expect } from 'vitest';
import { BRAND_OWNED_STORES, brandOwnedStore } from './brand-stores';

describe('brandOwnedStore', () => {
  it('map đúng 2 store riêng của brand (TA kèm config shipCost INS $5)', () => {
    expect(brandOwnedStore('tinhatelier')).toEqual({
      vendor: 'TINH Atelier', brandSlug: 'tinh',
      shipCost: { insHandlingUsd: 5, fxVndPerUsd: 26_000 },
    });
    expect(brandOwnedStore('mirermirer-official')).toEqual({ vendor: 'Mirer', brandSlug: 'mirer' });
  });
  it('store đa-brand / lạ / null → null', () => {
    expect(brandOwnedStore('meanblvd')).toBeNull();
    expect(brandOwnedStore('cici-mean')).toBeNull();
    expect(brandOwnedStore(null)).toBeNull();
  });
  it('map không rỗng và vendor/brandSlug đều có', () => {
    for (const v of Object.values(BRAND_OWNED_STORES)) {
      expect(v.vendor.length).toBeGreaterThan(0);
      expect(v.brandSlug.length).toBeGreaterThan(0);
    }
  });
});
