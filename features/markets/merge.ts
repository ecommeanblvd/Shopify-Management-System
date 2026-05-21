import type { Market, MarketStoreOverride, EffectiveMarket } from './types';

export function mergeMarketConfig(
  market: Market,
  override: MarketStoreOverride | null,
): EffectiveMarket {
  return {
    handle: market.handle,
    name: market.name,
    type: market.type,
    countries: [...market.countries],
    primaryCurrency: market.primaryCurrency,
    alternativeCurrencies: [...market.alternativeCurrencies],
    primaryLanguage: market.primaryLanguage,
    alternativeLanguages: [...market.alternativeLanguages],
    enabled: market.enabled,
    priceAdjustment: override?.priceAdjustment ?? null,
    shipping: override?.shipping ?? null,
  };
}
