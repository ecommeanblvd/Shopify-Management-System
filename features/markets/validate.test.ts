import { describe, it, expect } from 'vitest';
import {
  validateTemplate, validateOverride, ValidationError,
} from './validate';
import type { Market, MarketStoreOverride } from './types';

const baseMarket = (overrides: Partial<Market> = {}): Market => ({
  handle: 'us',
  name: 'United States',
  type: 'regional',
  countries: ['US'],
  primaryCurrency: 'USD',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
  ...overrides,
});

describe('validateTemplate', () => {
  it('passes for valid 11-market seed', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['US'] }),
      baseMarket({ handle: 'eu', countries: ['DE', 'FR'], primaryCurrency: 'EUR' }),
      baseMarket({ handle: 'intl', type: 'international', countries: [] }),
    ])).not.toThrow();
  });

  it('throws on duplicate country across regional markets', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['US', 'CA'] }),
      baseMarket({ handle: 'canada', countries: ['CA'] }),
    ])).toThrow(ValidationError);
  });

  it('throws when more than one international market exists', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'intl1', type: 'international', countries: [] }),
      baseMarket({ handle: 'intl2', type: 'international', countries: [] }),
    ])).toThrow(/exactly one international market/i);
  });

  it('throws when regional market has empty countries', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: [] }),
    ])).toThrow(/regional market .* must have at least one country/i);
  });

  it('throws when international market has countries', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'intl', type: 'international', countries: ['US'] }),
    ])).toThrow(/international market .* must have empty countries/i);
  });

  it('throws on duplicate handle', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['US'] }),
      baseMarket({ handle: 'us', countries: ['MX'] }),
    ])).toThrow(/duplicate handle/i);
  });

  it('throws on invalid ISO-2 country code', () => {
    expect(() => validateTemplate([
      baseMarket({ handle: 'us', countries: ['USA'] }),
    ])).toThrow(/invalid country code/i);
  });
});

describe('validateOverride', () => {
  const market = baseMarket({
    handle: 'europe',
    countries: ['DE', 'FR', 'IT'],
    primaryCurrency: 'EUR',
    alternativeCurrencies: ['GBP'],
  });

  const baseOverride = (o: Partial<MarketStoreOverride> = {}): MarketStoreOverride => ({
    storeId: 'store-1',
    marketHandle: 'europe',
    priceAdjustment: null,
    shipping: null,
    ...o,
  });

  it('passes for empty override', () => {
    expect(() => validateOverride(market, baseOverride())).not.toThrow();
  });

  it('passes for valid price adjustment +12%', () => {
    expect(() => validateOverride(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 12 },
    }))).not.toThrow();
  });

  it('throws on price adjustment below -50', () => {
    expect(() => validateOverride(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: -60 },
    }))).toThrow(/price adjustment .* between -50 and 200/i);
  });

  it('throws on price adjustment above 200', () => {
    expect(() => validateOverride(market, baseOverride({
      priceAdjustment: { type: 'percentage', value: 250 },
    }))).toThrow(/price adjustment .* between -50 and 200/i);
  });

  it('throws when zone country not in market countries', () => {
    expect(() => validateOverride(market, baseOverride({
      shipping: {
        zones: {
          'EU Standard': { countries: ['DE', 'US'], rates: {} },
        },
      },
    }))).toThrow(/country US .* not in market europe/i);
  });

  it('throws when rate currency not in market currencies', () => {
    expect(() => validateOverride(market, baseOverride({
      shipping: {
        zones: {
          'EU Standard': {
            countries: ['DE'],
            rates: { 'Std': { type: 'flat', price: 5, currency: 'JPY' } },
          },
        },
      },
    }))).toThrow(/currency JPY .* not in market europe currencies/i);
  });

  it('accepts rate currency in alternativeCurrencies', () => {
    expect(() => validateOverride(market, baseOverride({
      shipping: {
        zones: {
          'UK Zone': {
            countries: ['DE'],
            rates: { 'Std': { type: 'flat', price: 5, currency: 'GBP' } },
          },
        },
      },
    }))).not.toThrow();
  });
});
