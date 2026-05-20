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

  it('surfaces GraphQL errors as ConnectorError', async () => {
    const errGraphql = vi.fn(async () => ({ data: null, errors: [{ message: 'bad' }] }));
    await expect(runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: errGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(ConnectorError);
  });

  it('retries on throttle and succeeds on second attempt', async () => {
    vi.useFakeTimers();
    const throttledThenOk = vi.fn()
      .mockRejectedValueOnce(new Error('throttled by Shopify'))
      .mockResolvedValueOnce({ data: { ok: true } });

    const promise = runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { ok }',
      deps: { isEnabled: async () => true, graphql: throttledThenOk, decryptToken: async () => 'tok' },
    });

    // advance past the 500ms (2**0 * 500) backoff for attempt 0
    await vi.advanceTimersByTimeAsync(600);
    const result = await promise;

    vi.useRealTimers();
    expect(result).toEqual({ ok: true });
    expect(throttledThenOk).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on a non-throttle error', async () => {
    const boomGraphql = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(runQuery({
      store, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: boomGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(ConnectorError);
    expect(boomGraphql).toHaveBeenCalledTimes(1);
  });

  it('blocks when store status is not active', async () => {
    const disconnectedStore = { ...store, status: 'disconnected' as const };
    await expect(runQuery({
      store: disconnectedStore, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: okGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(ConnectorError);
  });

  it('blocks when maintenanceMode is true', async () => {
    const maintenanceStore = { ...store, maintenanceMode: true };
    await expect(runQuery({
      store: maintenanceStore, featureKey: 'settings-viewer', requiredScopes: ['read_shipping'],
      query: 'query { shop { name } }',
      deps: { isEnabled: async () => true, graphql: okGraphql, decryptToken: async () => 'tok' },
    })).rejects.toThrow(ConnectorError);
  });
});
