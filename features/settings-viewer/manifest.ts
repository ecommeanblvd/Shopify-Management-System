import type { FeatureManifest } from '@/lib/registry/registry';

export const settingsViewerManifest: FeatureManifest = {
  key: 'settings-viewer',
  name: 'Settings Viewer',
  version: '1.0.0',
  requiredScopes: ['read_shipping', 'read_checkout_branding'],
  hasWriteOperations: false,
};
