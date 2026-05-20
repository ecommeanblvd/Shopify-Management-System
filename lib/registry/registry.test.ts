import { describe, it, expect } from 'vitest';
import { createRegistry, type FeatureManifest } from './registry';

const manifest: FeatureManifest = {
  key: 'settings-viewer',
  name: 'Settings Viewer',
  version: '1.0.0',
  requiredScopes: ['read_shipping'],
  hasWriteOperations: false,
};

describe('registry', () => {
  it('registers and retrieves a feature by key', () => {
    const reg = createRegistry([manifest]);
    expect(reg.get('settings-viewer')?.name).toBe('Settings Viewer');
  });

  it('lists all registered features', () => {
    const reg = createRegistry([manifest]);
    expect(reg.list()).toHaveLength(1);
  });

  it('throws on duplicate feature keys', () => {
    expect(() => createRegistry([manifest, manifest])).toThrow(/duplicate/i);
  });
});
