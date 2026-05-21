import type { FeatureManifest } from '@/lib/registry/registry';

export const marketsManifest: FeatureManifest = {
  key: 'markets',
  name: 'Markets & Per-Market Shipping',
  version: '1.0.0',
  // Markets need write_markets for marketCreate/Update; write_shipping for
  // per-market delivery profile creation; write_shop_settings (or write_shop)
  // for currency/language updates. Verify scope names against Shopify Admin
  // API docs for the pinned API version at implement time.
  requiredScopes: ['write_markets', 'write_shipping', 'write_shop_settings'],
  hasWriteOperations: true,
};
