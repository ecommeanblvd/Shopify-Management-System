import { describe, it, expect, vi } from 'vitest';
import { runMarketsApply, type ApplyDeps, type ApplyStore } from './apply';
import type { MarketOps } from './diff';

const store: ApplyStore = {
  id: 'store-1', shopDomain: 'demo.myshopify.com', apiVersion: '2025-01',
  status: 'active', maintenanceMode: false,
  scopes: ['write_markets', 'write_shipping', 'write_shop_settings'],
};

function emptyOps(): MarketOps {
  return {
    marketsToCreate: [], marketsToUpdate: [], marketsToDelete: [],
    regionsToAdd: [], regionsToRemove: [],
    currencyUpdates: [], languageUpdates: [],
    priceListsToCreate: [], priceListsToUpdate: [], priceListsToDelete: [],
  };
}

function makeDeps(overrides: Partial<ApplyDeps> = {}): ApplyDeps {
  return {
    captureSnapshot: vi.fn(async () => {}),
    runMutation: vi.fn(async () => ({ data: {} })),
    recordAudit: vi.fn(async () => {}),
    insertApplyHistory: vi.fn(async () => 'history-1'),
    ...overrides,
  };
}

describe('runMarketsApply', () => {
  it('returns preview ops when dryRun=true and runs no mutations', async () => {
    const deps = makeDeps();
    const result = await runMarketsApply({
      store, applyRunId: 'preview', ops: emptyOps(),
      effectiveByHandle: {}, dryRun: true, deps,
    });
    expect(result.kind).toBe('preview');
    expect(deps.runMutation).not.toHaveBeenCalled();
  });

  it('captures snapshot before mutations when dryRun=false', async () => {
    const deps = makeDeps();
    await runMarketsApply({
      store, applyRunId: 'run-1', ops: emptyOps(),
      effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(deps.captureSnapshot).toHaveBeenCalledOnce();
  });

  it('executes create-market mutations before region adds (ordering)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      runMutation: vi.fn(async (args) => {
        if (args.mutation.includes('marketCreate')) calls.push('create-market');
        if (args.mutation.includes('marketRegionsCreate')) calls.push('regions-add');
        return { data: { marketCreate: { market: { id: 'gid://M/new' } } } };
      }),
    });
    const ops: MarketOps = {
      ...emptyOps(),
      marketsToCreate: [{
        handle: 'asia', name: 'Asia', type: 'regional', countries: ['JP'],
        primaryCurrency: 'JPY', alternativeCurrencies: [],
        primaryLanguage: 'ja', alternativeLanguages: [],
        enabled: true, priceAdjustment: null, shipping: null,
      }],
      regionsToAdd: [{ marketHandle: 'asia', countryCode: 'JP' }],
    };
    await runMarketsApply({
      store, applyRunId: 'run-2', ops, effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(calls[0]).toBe('create-market');
  });

  it('records audit success when all mutations succeed', async () => {
    const deps = makeDeps();
    await runMarketsApply({
      store, applyRunId: 'run-3', ops: emptyOps(),
      effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(deps.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ result: 'success' }),
    );
  });

  it('records partial_error and continues when one mutation fails', async () => {
    let count = 0;
    const deps = makeDeps({
      runMutation: vi.fn(async () => {
        count++;
        if (count === 1) throw new Error('Shopify rejected');
        return { data: {} };
      }),
    });
    const ops: MarketOps = {
      ...emptyOps(),
      marketsToUpdate: [
        { liveId: 'gid://M/1', effective: {} as never, changes: ['name'] },
        { liveId: 'gid://M/2', effective: {} as never, changes: ['enabled'] },
      ],
    };
    const result = await runMarketsApply({
      store, applyRunId: 'run-4', ops, effectiveByHandle: {}, dryRun: false, deps,
    });
    expect(result.kind).toBe('applied');
    expect(result.errors).toHaveLength(1);
  });
});
