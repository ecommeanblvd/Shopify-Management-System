import { describe, it, expect } from 'vitest';
import { mergeMarketConfig } from './merge';
import type { Market, MarketStoreOverride } from './types';

const market: Market = {
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: ['de'],
  enabled: true,
};

const baseOverride = (o: Partial<MarketStoreOverride> = {}): MarketStoreOverride => ({
  storeId: 'store-1',
  marketHandle: 'europe',
  priceAdjustment: null,
  shipping: null,
  ...o,
});

describe('mergeMarketConfig', () => {
  it('returns template fields plus null priceAdjustment + shipping when override empty', () => {
    expect(mergeMarketConfig(market, null)).toEqual({
      ...market,
      priceAdjustment: null,
      shipping: null,
    });
  });

  it('overlays priceAdjustment from override', () => {
    const result = mergeMarketConfig(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 12 },
    }));
    expect(result.priceAdjustment).toEqual({ type: 'percentage', value: 12 });
    expect(result.shipping).toBeNull();
  });

  it('overlays shipping from override', () => {
    const shipping = {
      zones: {
        'EU Standard': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat' as const, price: 5, currency: 'EUR' } },
        },
      },
    };
    const result = mergeMarketConfig(market, baseOverride({ shipping }));
    expect(result.shipping).toEqual(shipping);
  });

  it('does not mutate the template input', () => {
    const before = JSON.stringify(market);
    mergeMarketConfig(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 12 },
    }));
    expect(JSON.stringify(market)).toBe(before);
  });
});
