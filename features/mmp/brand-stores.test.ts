import { describe, it, expect } from 'vitest';
import { BRAND_OWNED_STORES, brandOwnedStore } from './brand-stores';

describe('brandOwnedStore', () => {
  it('map đúng 2 store riêng của brand, cả hai kèm config shipCost INS $5', () => {
    expect(brandOwnedStore('tinhatelier')).toEqual({
      vendor: 'TINH Atelier', brandSlug: 'tinh',
      shipCost: { insHandlingUsd: 5, fxVndPerUsd: 26_000 },
    });
    // CEO 11/09: Mirer tính y như TA — cước bill + 5 USD/đơn.
    expect(brandOwnedStore('mirermirer-official')).toEqual({
      vendor: 'Mirer', brandSlug: 'mirer',
      shipCost: { insHandlingUsd: 5, fxVndPerUsd: 26_000 },
    });
  });
  it('cả HAI store riêng đều gửi chi phí ship kèm phí xử lý 5 USD', () => {
    for (const ten of ['tinhatelier', 'mirermirer-official']) {
      expect(brandOwnedStore(ten)?.shipCost).toEqual({ insHandlingUsd: 5, fxVndPerUsd: 26_000 });
    }
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
