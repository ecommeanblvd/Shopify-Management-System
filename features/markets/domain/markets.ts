import type { MarketPriceAdjustment } from '../types';

export const MARKETS_QUERY = `
  query Markets {
    markets(first: 25) {
      edges { node {
        id
        handle
        name
        enabled
        primary
        regions(first: 250) {
          edges { node { __typename ... on MarketRegionCountry { code } } }
        }
        currencySettings {
          baseCurrency { currencyCode }
          localCurrencies
        }
        webPresence {
          defaultLocale
          alternateLocales { locale }
        }
        priceList {
          id
          parent { adjustment { type value } }
        }
      } }
    }
  }
`;

interface ShopifyMarketEdge {
  node: {
    id: string;
    handle: string;
    name: string;
    enabled: boolean;
    primary: boolean;
    regions?: { edges?: Array<{ node: { __typename: string; code?: string } }> };
    currencySettings?: {
      baseCurrency?: { currencyCode: string };
      localCurrencies?: boolean;
    };
    webPresence?: {
      defaultLocale?: string;
      alternateLocales?: Array<{ locale: string }>;
    };
    priceList?: {
      id: string;
      parent?: { adjustment?: { type: string; value: number } };
    } | null;
  };
}

export interface NormalizedMarket {
  id: string;
  handle: string;
  name: string;
  type: 'regional' | 'international';
  countries: string[];
  primaryCurrency: string;
  alternativeCurrencies: string[];
  primaryLanguage: string;
  alternativeLanguages: string[];
  enabled: boolean;
  primary: boolean;
  priceListId: string | null;
  priceAdjustment: MarketPriceAdjustment | null;
}

export function normalizeMarkets(data: unknown): NormalizedMarket[] {
  const typed = data as { markets?: { edges?: ShopifyMarketEdge[] } };
  const edges = typed?.markets?.edges ?? [];
  return edges.map((e) => {
    const n = e.node;
    const countries = (n.regions?.edges ?? [])
      .filter((r) => r.node.__typename === 'MarketRegionCountry' && r.node.code)
      .map((r) => r.node.code as string);
    const adj = n.priceList?.parent?.adjustment;
    const priceAdjustment: MarketPriceAdjustment | null = adj
      ? {
          type: 'percentage',
          value: adj.type === 'PERCENTAGE_DECREASE' ? -adj.value : adj.value,
        }
      : null;
    return {
      id: n.id,
      handle: n.handle,
      name: n.name,
      type: countries.length === 0 ? 'international' : 'regional',
      countries,
      primaryCurrency: n.currencySettings?.baseCurrency?.currencyCode ?? 'USD',
      alternativeCurrencies: [],
      primaryLanguage: n.webPresence?.defaultLocale ?? 'en',
      alternativeLanguages: (n.webPresence?.alternateLocales ?? []).map((l) => l.locale),
      enabled: n.enabled,
      primary: n.primary,
      priceListId: n.priceList?.id ?? null,
      priceAdjustment,
    };
  });
}
