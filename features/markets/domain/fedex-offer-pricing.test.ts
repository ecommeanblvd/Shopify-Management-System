import { describe, it, expect } from 'vitest';
import { fedexOfferPrice, PACKING_FEE_USD, ROUND_UP_USD } from './fedex-offer-pricing';

describe('fedexOfferPrice', () => {
  it('1 nước: (cost+5)×factor làm tròn lên $0.5', () => {
    // cost 39.35, final 45.2525 → factor 1.15 → (39.35+5)×1.15=51.0525 → ceil .5 = 51.5
    expect(fedexOfferPrice([{ carrierCostDisplay: 39.35, finalDisplay: 45.2525 }])).toBe(51.5);
  });
  it('max trên nhiều nước', () => {
    const r = fedexOfferPrice([
      { carrierCostDisplay: 30, finalDisplay: 34.5 },   // (30+5)×1.15=40.25 → 40.5
      { carrierCostDisplay: 39.35, finalDisplay: 45.2525 }, // → 51.5
    ]);
    expect(r).toBe(51.5);
  });
  it('bỏ nước carrierCostDisplay=0', () => {
    expect(fedexOfferPrice([{ carrierCostDisplay: 0, finalDisplay: 0 },
      { carrierCostDisplay: 10, finalDisplay: 11.5 }])).toBe(17.5); // (10+5)×1.15=17.25→17.5
  });
  it('rỗng / toàn 0 → null', () => {
    expect(fedexOfferPrice([])).toBeNull();
    expect(fedexOfferPrice([{ carrierCostDisplay: 0, finalDisplay: 0 }])).toBeNull();
  });
  it('hằng số', () => { expect(PACKING_FEE_USD).toBe(5); expect(ROUND_UP_USD).toBe(0.5); });
});
