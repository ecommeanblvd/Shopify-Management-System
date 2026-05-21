import type { MarketOps } from './diff';
import type { EffectiveMarket } from './types';
import {
  buildMarketCreateInput, buildMarketUpdateInput, buildMarketRegionsCreate,
  MARKET_CREATE_MUTATION, MARKET_UPDATE_MUTATION, MARKET_DELETE_MUTATION,
  MARKET_REGIONS_CREATE_MUTATION, MARKET_REGION_DELETE_MUTATION,
} from './domain/markets';
import {
  buildCurrencySettingsInput, CURRENCY_SETTINGS_UPDATE_MUTATION,
} from './domain/currencies';
import { WEB_PRESENCE_UPDATE_MUTATION } from './domain/languages';
import {
  buildPriceListInput,
  PRICE_LIST_CREATE_MUTATION, PRICE_LIST_UPDATE_MUTATION, PRICE_LIST_DELETE_MUTATION,
} from './domain/price-adjustments';

export interface ApplyStore {
  id: string; shopDomain: string; apiVersion: string;
  status: 'active' | 'disconnected' | 'error';
  maintenanceMode: boolean; scopes: string[];
}

export interface ApplyDeps {
  captureSnapshot: (args: { storeId: string; payload: unknown; applyRunId: string }) => Promise<void>;
  runMutation: (args: {
    store: ApplyStore; applyRunId: string;
    mutation: string; variables: Record<string, unknown>;
  }) => Promise<{ data: unknown }>;
  recordAudit: (entry: {
    storeId: string; applyRunId: string;
    action: string; target?: string;
    result: 'success' | 'error' | 'partial_error';
    errorDetail?: string | null;
    requestSummary?: string | null;
  }) => Promise<void>;
  insertApplyHistory: (args: {
    storeId: string; marketHandle: string | null;
    action: string; status: 'success' | 'partial_error' | 'failed';
    diff: unknown; errorDetail: string | null;
  }) => Promise<string>;
}

export interface ApplyArgs {
  store: ApplyStore;
  applyRunId: string;
  ops: MarketOps;
  effectiveByHandle: Record<string, EffectiveMarket>;
  dryRun: boolean;
  deps: ApplyDeps;
}

export type ApplyResult =
  | { kind: 'preview'; ops: MarketOps }
  | { kind: 'applied'; ops: MarketOps; errors: Array<{ step: string; error: string }> };

export async function runMarketsApply(args: ApplyArgs): Promise<ApplyResult> {
  const { store, applyRunId, ops, effectiveByHandle, dryRun, deps } = args;

  if (dryRun) {
    return { kind: 'preview', ops };
  }

  await deps.captureSnapshot({ storeId: store.id, payload: ops, applyRunId });

  const errors: Array<{ step: string; error: string }> = [];
  const liveIdByHandle = new Map<string, string>();

  // 1. Create markets first (so subsequent ops can reference their IDs)
  for (const m of ops.marketsToCreate) {
    try {
      const res = await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_CREATE_MUTATION,
        variables: { input: buildMarketCreateInput(m) },
      });
      const created = (res.data as { marketCreate?: { market?: { id: string } } })
        ?.marketCreate?.market;
      if (created?.id) liveIdByHandle.set(m.handle, created.id);
    } catch (err) {
      errors.push({ step: `marketCreate:${m.handle}`, error: String(err) });
    }
  }

  // 2. Update existing markets
  for (const u of ops.marketsToUpdate) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_UPDATE_MUTATION,
        variables: { id: u.liveId, input: buildMarketUpdateInput(u.effective) },
      });
    } catch (err) {
      errors.push({ step: `marketUpdate:${u.effective?.handle ?? u.liveId}`, error: String(err) });
    }
  }

  // 3. Add regions (requires market ID resolved from step 1)
  for (const r of ops.regionsToAdd) {
    const marketId = liveIdByHandle.get(r.marketHandle);
    if (!marketId) {
      errors.push({ step: `regionsAdd:${r.countryCode}`, error: `No marketId for handle ${r.marketHandle}` });
      continue;
    }
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_REGIONS_CREATE_MUTATION,
        variables: { marketId, regions: buildMarketRegionsCreate([r.countryCode]) },
      });
    } catch (err) {
      errors.push({ step: `regionsAdd:${r.marketHandle}/${r.countryCode}`, error: String(err) });
    }
  }

  // 4. Currency updates
  for (const c of ops.currencyUpdates) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: CURRENCY_SETTINGS_UPDATE_MUTATION,
        variables: {
          marketId: c.liveId,
          input: buildCurrencySettingsInput(c.primary, c.alternatives),
        },
      });
    } catch (err) {
      errors.push({ step: `currencyUpdate:${c.liveId}`, error: String(err) });
    }
  }

  // 5. Language (web presence) updates
  // Note: creating a new web presence requires a separate flow; this handles updates only.
  for (const l of ops.languageUpdates) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: WEB_PRESENCE_UPDATE_MUTATION,
        variables: {
          webPresenceId: l.liveId,
          webPresence: { defaultLocale: l.defaultLocale, alternateLocales: l.alternateLocales },
        },
      });
    } catch (err) {
      errors.push({ step: `languageUpdate:${l.liveId}`, error: String(err) });
    }
  }

  // 6. Price lists: create
  for (const p of ops.priceListsToCreate) {
    const marketId = liveIdByHandle.get(p.marketHandle);
    const market = effectiveByHandle[p.marketHandle];
    if (!marketId || !market) {
      errors.push({
        step: `priceListCreate:${p.marketHandle}`,
        error: 'Missing marketId or effective market',
      });
      continue;
    }
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: PRICE_LIST_CREATE_MUTATION,
        variables: {
          input: buildPriceListInput({
            marketId,
            marketName: market.name,
            currency: market.primaryCurrency,
            adjustmentValue: p.adjustment.value,
          }),
        },
      });
    } catch (err) {
      errors.push({ step: `priceListCreate:${p.marketHandle}`, error: String(err) });
    }
  }

  // 6b. Price lists: update
  for (const p of ops.priceListsToUpdate) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: PRICE_LIST_UPDATE_MUTATION,
        variables: {
          id: p.priceListId,
          input: {
            parent: {
              adjustment: {
                type: p.adjustment.value < 0 ? 'PERCENTAGE_DECREASE' : 'PERCENTAGE_INCREASE',
                value: Math.abs(p.adjustment.value),
              },
            },
          },
        },
      });
    } catch (err) {
      errors.push({ step: `priceListUpdate:${p.priceListId}`, error: String(err) });
    }
  }

  // 6c. Price lists: delete
  for (const plId of ops.priceListsToDelete) {
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: PRICE_LIST_DELETE_MUTATION,
        variables: { id: plId },
      });
    } catch (err) {
      errors.push({ step: `priceListDelete:${plId}`, error: String(err) });
    }
  }

  // 7. Remove regions
  for (const r of ops.regionsToRemove) {
    try {
      // Note: MARKET_REGION_DELETE_MUTATION requires the region row's GID, not the country code.
      // Task 14 (probe script) verifies the actual region ID format on a live store; the variable
      // name is kept as `id` here and will be updated once the live format is confirmed.
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_REGION_DELETE_MUTATION,
        variables: { id: r.countryCode },
      });
    } catch (err) {
      errors.push({ step: `regionRemove:${r.marketHandle}/${r.countryCode}`, error: String(err) });
    }
  }

  // 8. Delete markets last (after all dependent resources are removed)
  for (const d of ops.marketsToDelete) {
    if (d.primary) {
      errors.push({ step: `marketDelete:${d.handle}`, error: 'Cannot delete primary market' });
      continue;
    }
    try {
      await deps.runMutation({
        store, applyRunId,
        mutation: MARKET_DELETE_MUTATION,
        variables: { id: d.liveId },
      });
    } catch (err) {
      errors.push({ step: `marketDelete:${d.handle}`, error: String(err) });
    }
  }

  const totalOps =
    ops.marketsToCreate.length + ops.marketsToUpdate.length + ops.marketsToDelete.length +
    ops.regionsToAdd.length + ops.regionsToRemove.length +
    ops.currencyUpdates.length + ops.languageUpdates.length +
    ops.priceListsToCreate.length + ops.priceListsToUpdate.length + ops.priceListsToDelete.length;

  const status: 'success' | 'partial_error' | 'failed' =
    errors.length === 0 ? 'success'
    : errors.length === totalOps && totalOps > 0 ? 'failed'
    : 'partial_error';

  await deps.insertApplyHistory({
    storeId: store.id, marketHandle: null, action: 'apply',
    status,
    diff: ops,
    errorDetail: errors.length > 0 ? JSON.stringify(errors) : null,
  });

  await deps.recordAudit({
    storeId: store.id, applyRunId, action: 'apply_markets',
    result: status === 'success' ? 'success' : status === 'failed' ? 'error' : 'partial_error',
    requestSummary: `total=${totalOps} errors=${errors.length}`,
    errorDetail: errors.length > 0 ? JSON.stringify(errors) : null,
  });

  return { kind: 'applied', ops, errors };
}
