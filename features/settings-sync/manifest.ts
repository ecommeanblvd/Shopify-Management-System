import type { FeatureManifest } from '@/lib/registry/registry';

export const settingsSyncManifest: FeatureManifest = {
  key: 'settings-sync',
  name: 'Settings Sync',
  version: '1.0.0',
  // Verify these scope names against the Shopify Admin API docs at implement time.
  // Shipping mutations need write_shipping. Buyer experience is configured via
  // shopBuyerExperienceConfigurationUpdate which needs write_shop_settings (or
  // write_shop depending on API version). Adjust if the API requires different
  // scope names; commit the verified set with a one-line comment citing the doc.
  requiredScopes: ['write_shipping', 'write_shop_settings'],
  hasWriteOperations: true,
};
