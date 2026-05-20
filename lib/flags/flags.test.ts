import { describe, it, expect } from 'vitest';
import { isFeatureEnabled } from './flags';

describe('isFeatureEnabled', () => {
  const rows = [
    { featureKey: 'settings-viewer', storeId: 'store-a', enabled: true },
    { featureKey: 'settings-viewer', storeId: 'store-b', enabled: false },
  ];
  const lookup = async (featureKey: string, storeId: string) =>
    rows.find((r) => r.featureKey === featureKey && r.storeId === storeId) ?? null;

  it('returns true when the flag row is enabled', async () => {
    expect(await isFeatureEnabled('settings-viewer', 'store-a', lookup)).toBe(true);
  });

  it('returns false when the flag row is disabled', async () => {
    expect(await isFeatureEnabled('settings-viewer', 'store-b', lookup)).toBe(false);
  });

  it('returns false (default-off) when no flag row exists', async () => {
    expect(await isFeatureEnabled('settings-viewer', 'store-c', lookup)).toBe(false);
  });
});
