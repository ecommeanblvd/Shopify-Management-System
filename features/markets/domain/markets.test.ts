import { describe, it, expect } from 'vitest';
import { MARKETS_QUERY, normalizeMarkets } from './markets';

describe('MARKETS_QUERY', () => {
  it('is a non-empty GraphQL query string', () => {
    expect(MARKETS_QUERY).toContain('query');
    expect(MARKETS_QUERY).toContain('markets');
  });
});

describe('normalizeMarkets', () => {
  it('returns empty array when response has no markets', () => {
    expect(normalizeMarkets({ markets: { edges: [] } })).toEqual([]);
  });

  it('normalizes a single market with regions', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/1',
            handle: 'united-states',
            name: 'United States',
            enabled: true,
            primary: true,
            regions: { edges: [{ node: { __typename: 'MarketRegionCountry', code: 'US' } }] },
            currencySettings: {
              baseCurrency: { currencyCode: 'USD' },
              localCurrencies: false,
            },
            webPresence: { defaultLocale: 'en', alternateLocales: [] },
            priceList: null,
          },
        }],
      },
    });
    expect(result).toEqual([{
      id: 'gid://shopify/Market/1',
      handle: 'united-states',
      name: 'United States',
      type: 'regional',
      countries: ['US'],
      primaryCurrency: 'USD',
      alternativeCurrencies: [],
      primaryLanguage: 'en',
      alternativeLanguages: [],
      enabled: true,
      primary: true,
      priceListId: null,
      priceAdjustment: null,
    }]);
  });

  it('marks markets with empty regions as international type', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/9',
            handle: 'international',
            name: 'International',
            enabled: true,
            primary: false,
            regions: { edges: [] },
            currencySettings: { baseCurrency: { currencyCode: 'USD' }, localCurrencies: false },
            webPresence: { defaultLocale: 'en', alternateLocales: [] },
            priceList: null,
          },
        }],
      },
    });
    expect(result[0].type).toBe('international');
    expect(result[0].countries).toEqual([]);
  });

  it('extracts price adjustment from priceList', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/2',
            handle: 'europe',
            name: 'Europe',
            enabled: true,
            primary: false,
            regions: { edges: [{ node: { __typename: 'MarketRegionCountry', code: 'DE' } }] },
            currencySettings: { baseCurrency: { currencyCode: 'EUR' }, localCurrencies: false },
            webPresence: { defaultLocale: 'en', alternateLocales: [{ locale: 'de' }] },
            priceList: {
              id: 'gid://shopify/PriceList/77',
              parent: { adjustment: { type: 'PERCENTAGE_INCREASE', value: 12 } },
            },
          },
        }],
      },
    });
    expect(result[0].priceListId).toBe('gid://shopify/PriceList/77');
    expect(result[0].priceAdjustment).toEqual({ type: 'percentage', value: 12 });
    expect(result[0].alternativeLanguages).toEqual(['de']);
  });

  it('converts PERCENTAGE_DECREASE to negative value', () => {
    const result = normalizeMarkets({
      markets: {
        edges: [{
          node: {
            id: 'gid://shopify/Market/3',
            handle: 'asia',
            name: 'Asia',
            enabled: true,
            primary: false,
            regions: { edges: [{ node: { __typename: 'MarketRegionCountry', code: 'JP' } }] },
            currencySettings: { baseCurrency: { currencyCode: 'JPY' }, localCurrencies: false },
            webPresence: { defaultLocale: 'ja', alternateLocales: [] },
            priceList: {
              id: 'gid://shopify/PriceList/88',
              parent: { adjustment: { type: 'PERCENTAGE_DECREASE', value: 5 } },
            },
          },
        }],
      },
    });
    expect(result[0].priceAdjustment).toEqual({ type: 'percentage', value: -5 });
  });
});
