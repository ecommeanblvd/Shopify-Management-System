import { describe, it, expect, vi } from 'vitest';
import { runQuery, ConnectorError } from './connector';

const store = {
  id: 's1', shopDomain: 'shop.myshopify.com', apiVersion: '2025-01',
  status: 'active' as const, maintenanceMode: false, scopes: ['read_shipping'],
};

const okGraphql = vi.fn(async () => ({ data: { shop: { name: 'Shop' } } }));

describe('runQuery', () => {
  it('runs the query when flag is on, scopes satisfied, store active', async () => {
    const result = await runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: okGraphql, decryptToken: async () => 'tok' },
    });
    expect(result.shop.name).toBe('Shop');
    expect(okGraphql).toHaveBeenCalled();
  });

  it('blocks when the feature flag is off', async () => {
    await expect(runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => false, graphql: okGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(ConnectorError);
  });

  it('blocks when a required scope is missing', async () => {
    await expect(runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_checkout_branding'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: okGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(/scope/i);
  });

  it('blocks reads are still allowed but writes are unrepresentable (no mutate export)', async () => {
    const mod = await import('./connector');
    expect((mod as Record<string, unknown>).mutate).toBeUndefined();
  });
});
