import { describe, it, expect, vi } from 'vitest';
import { runMutation, WriterError, type WriterDeps } from './writer';

const store = {
  id: 's1', shopDomain: 'shop.myshopify.com', apiVersion: '2025-01',
  status: 'active' as const, maintenanceMode: false, scopes: ['write_shipping'],
};

const baseDeps: WriterDeps = {
  isEnabled: async () => true,
  isReconciled: async () => true,
  hasSnapshot: async () => true,
  manifestHasWriteOps: () => true,
  graphql: vi.fn(async () => ({ data: { ok: true } })),
  decryptToken: async () => 'tok',
};

const baseArgs = {
  store,
  featureKey: 'settings-sync',
  requiredScopes: ['write_shipping'],
  applyRunId: 'r1',
  domain: 'shipping',
  mutation: 'mutation { x }',
};

describe('runMutation', () => {
  it('runs the mutation when all four gates pass', async () => {
    const result = await runMutation({ ...baseArgs, deps: baseDeps });
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it('blocks when the feature manifest does not declare write operations', async () => {
    await expect(runMutation({
      ...baseArgs,
      deps: { ...baseDeps, manifestHasWriteOps: () => false },
    })).rejects.toThrow(WriterError);
  });

  it('blocks when reconciliation is pending for the store+domain', async () => {
    await expect(runMutation({
      ...baseArgs,
      deps: { ...baseDeps, isReconciled: async () => false },
    })).rejects.toThrow(/reconcil/i);
  });

  it('blocks when no snapshot has been captured for this apply run', async () => {
    await expect(runMutation({
      ...baseArgs,
      deps: { ...baseDeps, hasSnapshot: async () => false },
    })).rejects.toThrow(/snapshot/i);
  });

  it('blocks when the feature flag is off (read-time guard)', async () => {
    await expect(runMutation({
      ...baseArgs,
      deps: { ...baseDeps, isEnabled: async () => false },
    })).rejects.toThrow(/not enabled/i);
  });

  it('blocks when a required scope is missing (read-time guard)', async () => {
    await expect(runMutation({
      ...baseArgs,
      requiredScopes: ['write_shop_settings'],
      deps: baseDeps,
    })).rejects.toThrow(/scope/i);
  });
});
