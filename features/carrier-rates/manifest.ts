import type { FeatureManifest } from '@/lib/registry/registry';

export const carrierRatesManifest: FeatureManifest = {
  key: 'carrier-rates',
  name: 'Carrier Rates',
  version: '1.0.0',
  // Carrier rates does not call Shopify directly. The push step writes into
  // market_store_overrides, then the existing Markets apply (write_shipping)
  // is what touches Shopify. So no Shopify scopes are required here.
  requiredScopes: [],
  hasWriteOperations: false,
};
