import { describe, it, expect } from 'vitest';
import { planSeedRows, mergeSystemShippingRows } from './system-shipping-domain';

describe('planSeedRows', () => {
  it('lấy override có shipping, bỏ override shipping null', () => {
    const rows = planSeedRows([
      { storeId: 's', marketHandle: 'europe', priceAdjustment: null, shipping: { zones: { EU1: { countries: ['FR'], rates: {} } } } },
      { storeId: 's', marketHandle: 'korea', priceAdjustment: null, shipping: null },
    ] as never);
    expect(rows).toEqual([{ marketHandle: 'europe', shipping: { zones: { EU1: { countries: ['FR'], rates: {} } } } }]);
  });
});

describe('mergeSystemShippingRows', () => {
  it('gộp zones của nhiều market thành 1 tree', () => {
    const tree = mergeSystemShippingRows([
      { marketHandle: 'europe', shipping: { zones: { EU1: { countries: ['FR'], rates: {} } } } },
      { marketHandle: 'korea', shipping: { zones: { KO1: { countries: ['KR'], rates: {} } } } },
    ] as never);
    expect(Object.keys(tree.zones).sort()).toEqual(['EU1', 'KO1']);
  });
});
