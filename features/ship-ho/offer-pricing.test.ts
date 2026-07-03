import { describe, it, expect } from 'vitest';
import { computeOffer, MIN_MARKUP_PERCENT } from './offer-pricing';

describe('computeOffer', () => {
  it('margin = base×markup%, charged = carrierCost + margin', () => {
    // base 100k, markup 30% → margin 30k; carrierCost 250k → charged 280k
    expect(computeOffer(250000, 100000, 30)).toEqual({ chargedVnd: 280000, marginVnd: 30000 });
  });
  it('margin CHỈ theo base — carrierCost lớn không đổi margin', () => {
    const a = computeOffer(250000, 100000, 30);
    const b = computeOffer(999000, 100000, 30);
    expect(a.marginVnd).toBe(b.marginVnd); // 30000
    expect(b.chargedVnd).toBe(999000 + 30000);
  });
  it('markup 0 → margin 0, charged = carrierCost', () => {
    expect(computeOffer(250000, 100000, 0)).toEqual({ chargedVnd: 250000, marginVnd: 0 });
  });
  it('làm tròn VND', () => {
    // base 100000 × 15.5% = 15500
    expect(computeOffer(200000, 100000, 15.5)).toEqual({ chargedVnd: 215500, marginVnd: 15500 });
  });
  it('markup âm không cho margin âm (clamp ≥ 0)', () => {
    expect(computeOffer(200000, 100000, -50)).toEqual({ chargedVnd: 200000, marginVnd: 0 });
  });
  it('MIN_MARKUP_PERCENT = 30', () => {
    expect(MIN_MARKUP_PERCENT).toBe(30);
  });
});
