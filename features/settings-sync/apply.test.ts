import { describe, it, expect, vi } from 'vitest';
import { runApplyForStore, type ApplyDeps, type DomainAdapter } from './apply';

const store = {
  id: 's1', shopDomain: 'shop.myshopify.com', apiVersion: '2025-01',
  status: 'active' as const, maintenanceMode: false, scopes: ['write_shipping'],
};

const adapter: DomainAdapter = {
  fetchQuery: 'query { x }',
  normalize: (data) => ({ tree: data as Record<string, unknown>, shopifyIds: {} }),
  buildMutation: (current, effective) => ({ mutation: 'mutation { y }', variables: { current, effective } }),
};

function makeDeps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    isReconciled: async () => true,
    readCurrent: async () => ({}),
    captureSnapshot: vi.fn(async () => undefined),
    runMutation: vi.fn(async () => ({ ok: true })),
    listOverrides: async () => [],
    recordAudit: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('runApplyForStore', () => {
  it('returns dry-run ops without calling mutation or snapshot', async () => {
    const deps = makeDeps();
    const result = await runApplyForStore({
      store, applyRunId: 'r1', domain: 'shipping',
      template: { zones: { Domestic: { rates: { Standard: { price: 35000 } } } } },
      adapter, dryRun: true, deps,
    });
    expect(result.kind).toBe('preview');
    expect(deps.captureSnapshot).not.toHaveBeenCalled();
    expect(deps.runMutation).not.toHaveBeenCalled();
  });

  it('captures a snapshot then runs the mutation when not dry-run', async () => {
    const deps = makeDeps();
    const result = await runApplyForStore({
      store, applyRunId: 'r1', domain: 'shipping',
      template: { zones: { Domestic: { rates: { Standard: { price: 35000 } } } } },
      adapter, dryRun: false, deps,
    });
    expect(result.kind).toBe('applied');
    expect(deps.captureSnapshot).toHaveBeenCalledTimes(1);
    expect(deps.runMutation).toHaveBeenCalledTimes(1);
  });

  it('refuses to apply when reconciliation is pending', async () => {
    const deps = makeDeps({ isReconciled: async () => false });
    await expect(runApplyForStore({
      store, applyRunId: 'r1', domain: 'shipping',
      template: {}, adapter, dryRun: false, deps,
    })).rejects.toThrow(/reconcil/i);
  });

  it('records an audit row on mutation failure', async () => {
    const deps = makeDeps({
      runMutation: vi.fn(async () => { throw new Error('boom'); }) as ApplyDeps['runMutation'],
    });
    await expect(runApplyForStore({
      store, applyRunId: 'r1', domain: 'shipping',
      template: {}, adapter, dryRun: false, deps,
    })).rejects.toThrow();
    expect(deps.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ result: 'error' }));
  });
});
