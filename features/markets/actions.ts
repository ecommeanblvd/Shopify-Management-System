'use server';

import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { runQuery } from '@/lib/shopify/connector';
import { runMutation } from '@/lib/shopify/writer';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { recordAudit } from '@/lib/logging/audit';
import { hashPayload } from '@/lib/snapshots/snapshots';
import { marketsManifest } from './manifest';
import { DEFAULT_MARKETS } from './seed';
import { validateTemplate, validateOverride } from './validate';
import { mergeMarketConfig } from './merge';
import { diffMarkets } from './diff';
import { MARKETS_QUERY, normalizeMarkets } from './domain/markets';
import { runMarketsApply, type ApplyStore, type ApplyDeps } from './apply';
import type {
  Market, MarketStoreOverride, MarketPriceAdjustment, MarketShipping, EffectiveMarket,
} from './types';

export async function seedDefaultMarkets(userId: string): Promise<void> {
  validateTemplate(DEFAULT_MARKETS);
  for (const m of DEFAULT_MARKETS) {
    const [existing] = await db
      .select()
      .from(schema.marketTemplates)
      .where(eq(schema.marketTemplates.handle, m.handle))
      .limit(1);
    if (existing) continue;
    await db.insert(schema.marketTemplates).values({
      handle: m.handle,
      name: m.name,
      type: m.type,
      countries: m.countries,
      primaryCurrency: m.primaryCurrency,
      alternativeCurrencies: m.alternativeCurrencies,
      primaryLanguage: m.primaryLanguage,
      alternativeLanguages: m.alternativeLanguages,
      enabled: m.enabled,
      version: 1,
      updatedBy: userId,
    });
  }
}

export async function listTemplates(): Promise<Market[]> {
  const rows = await db.select().from(schema.marketTemplates);
  return rows.map((r) => ({
    handle: r.handle,
    name: r.name,
    type: r.type,
    countries: r.countries as string[],
    primaryCurrency: r.primaryCurrency,
    alternativeCurrencies: r.alternativeCurrencies as string[],
    primaryLanguage: r.primaryLanguage,
    alternativeLanguages: r.alternativeLanguages as string[],
    enabled: r.enabled,
  }));
}

export async function saveTemplate(market: Market, userId: string): Promise<void> {
  const allMarkets = await listTemplates();
  const next = allMarkets.filter((m) => m.handle !== market.handle).concat(market);
  validateTemplate(next);
  const [existing] = await db
    .select()
    .from(schema.marketTemplates)
    .where(eq(schema.marketTemplates.handle, market.handle))
    .limit(1);
  if (existing) {
    await db.update(schema.marketTemplates).set({
      name: market.name,
      type: market.type,
      countries: market.countries,
      primaryCurrency: market.primaryCurrency,
      alternativeCurrencies: market.alternativeCurrencies,
      primaryLanguage: market.primaryLanguage,
      alternativeLanguages: market.alternativeLanguages,
      enabled: market.enabled,
      version: existing.version + 1,
      updatedBy: userId,
      updatedAt: new Date(),
    }).where(eq(schema.marketTemplates.handle, market.handle));
  } else {
    await db.insert(schema.marketTemplates).values({
      handle: market.handle, name: market.name, type: market.type,
      countries: market.countries,
      primaryCurrency: market.primaryCurrency,
      alternativeCurrencies: market.alternativeCurrencies,
      primaryLanguage: market.primaryLanguage,
      alternativeLanguages: market.alternativeLanguages,
      enabled: market.enabled,
      version: 1, updatedBy: userId,
    });
  }
}

export async function deleteTemplate(handle: string): Promise<void> {
  await db.delete(schema.marketTemplates).where(eq(schema.marketTemplates.handle, handle));
}

export async function getOverride(
  storeId: string, handle: string,
): Promise<MarketStoreOverride | null> {
  const [row] = await db.select().from(schema.marketStoreOverrides).where(and(
    eq(schema.marketStoreOverrides.storeId, storeId),
    eq(schema.marketStoreOverrides.marketHandle, handle),
  )).limit(1);
  if (!row) return null;
  return {
    storeId: row.storeId,
    marketHandle: row.marketHandle,
    priceAdjustment: row.priceAdjustment as MarketPriceAdjustment | null,
    shipping: row.shipping as MarketShipping | null,
  };
}

export async function saveOverride(
  override: MarketStoreOverride, userId: string,
): Promise<void> {
  const [market] = await db.select().from(schema.marketTemplates)
    .where(eq(schema.marketTemplates.handle, override.marketHandle)).limit(1);
  if (!market) throw new Error(`Market ${override.marketHandle} not found`);
  validateOverride(
    {
      handle: market.handle, name: market.name, type: market.type,
      countries: market.countries as string[],
      primaryCurrency: market.primaryCurrency,
      alternativeCurrencies: market.alternativeCurrencies as string[],
      primaryLanguage: market.primaryLanguage,
      alternativeLanguages: market.alternativeLanguages as string[],
      enabled: market.enabled,
    },
    override,
  );
  const [existing] = await db.select().from(schema.marketStoreOverrides).where(and(
    eq(schema.marketStoreOverrides.storeId, override.storeId),
    eq(schema.marketStoreOverrides.marketHandle, override.marketHandle),
  )).limit(1);
  if (existing) {
    await db.update(schema.marketStoreOverrides).set({
      priceAdjustment: override.priceAdjustment,
      shipping: override.shipping,
      version: existing.version + 1,
      updatedBy: userId, updatedAt: new Date(),
    }).where(and(
      eq(schema.marketStoreOverrides.storeId, override.storeId),
      eq(schema.marketStoreOverrides.marketHandle, override.marketHandle),
    ));
  } else {
    await db.insert(schema.marketStoreOverrides).values({
      storeId: override.storeId,
      marketHandle: override.marketHandle,
      priceAdjustment: override.priceAdjustment,
      shipping: override.shipping,
      version: 1,
      updatedBy: userId,
    });
  }
}

export async function listOverridesForStore(storeId: string): Promise<MarketStoreOverride[]> {
  const rows = await db.select().from(schema.marketStoreOverrides)
    .where(eq(schema.marketStoreOverrides.storeId, storeId));
  return rows.map((r) => ({
    storeId: r.storeId,
    marketHandle: r.marketHandle,
    priceAdjustment: r.priceAdjustment as MarketPriceAdjustment | null,
    shipping: r.shipping as MarketShipping | null,
  }));
}

function buildApplyDeps(userId: string | null): ApplyDeps {
  return {
    captureSnapshot: async (args) => {
      // Markets uses its own apply history (market_apply_history) rather than apply_runs,
      // so applyRunId is not stored — the FK on settings_snapshots references apply_runs
      // which markets does not insert into.
      await db.insert(schema.settingsSnapshots).values({
        storeId: args.storeId,
        domain: 'markets',
        payload: args.payload as object,
        payloadHash: hashPayload(args.payload),
      });
    },
    runMutation: async ({ store, applyRunId, mutation, variables }) => {
      const data = await runMutation({
        store: store as ApplyStore,
        featureKey: marketsManifest.key,
        requiredScopes: marketsManifest.requiredScopes,
        applyRunId, domain: 'markets', mutation, variables,
        deps: {
          isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
          isReconciled: async () => true,
          hasSnapshot: async (sid, _d, runId) => {
            if (runId === 'preview') return true;
            // Markets stores snapshots without applyRunId (no apply_runs FK).
            // A snapshot for this store+domain captured just before mutation is sufficient.
            const [row] = await db.select().from(schema.settingsSnapshots).where(and(
              eq(schema.settingsSnapshots.storeId, sid),
              eq(schema.settingsSnapshots.domain, 'markets'),
            )).limit(1);
            return !!row;
          },
          manifestHasWriteOps: () => marketsManifest.hasWriteOperations,
          graphql: ({ shopDomain, apiVersion, token, mutation: m, variables: v }) =>
            graphqlCall({ shopDomain, apiVersion, token, query: m, variables: v }),
          decryptToken: getStoreToken,
        },
      });
      return { data };
    },
    recordAudit: async (entry) =>
      recordAudit({
        userId,
        storeId: entry.storeId,
        featureKey: marketsManifest.key,
        action: entry.action,
        target: entry.target ?? 'markets',
        requestSummary: entry.requestSummary ?? null,
        result: entry.result === 'partial_error' ? 'error' : entry.result,
        errorDetail: entry.errorDetail ?? null,
      }),
    insertApplyHistory: async (args) => {
      const [row] = await db.insert(schema.marketApplyHistory).values({
        storeId: args.storeId,
        marketHandle: args.marketHandle,
        userId,
        action: args.action,
        status: args.status,
        diff: args.diff as object,
        errorDetail: args.errorDetail,
      }).returning();
      return row.id;
    },
  };
}

async function readLiveMarkets(store: ApplyStore) {
  const data = await runQuery({
    store: {
      id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
      status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
    },
    featureKey: marketsManifest.key,
    requiredScopes: marketsManifest.requiredScopes,
    query: MARKETS_QUERY,
    deps: {
      isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
      graphql: ({ shopDomain, apiVersion, token, query, variables }) =>
        graphqlCall({ shopDomain, apiVersion, token, query, variables }),
      decryptToken: getStoreToken,
    },
  });
  return normalizeMarkets(data);
}

async function buildEffective(storeId: string): Promise<EffectiveMarket[]> {
  const templates = await listTemplates();
  const overrides = await listOverridesForStore(storeId);
  const overrideByHandle = new Map(overrides.map((o) => [o.marketHandle, o] as const));
  return templates.map((t) => mergeMarketConfig(t, overrideByHandle.get(t.handle) ?? null));
}

export async function previewMarketsApply(storeId: string) {
  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);
  const applyStore: ApplyStore = {
    id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
    status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
  };
  const live = await readLiveMarkets(applyStore);
  const effective = await buildEffective(storeId);
  const ops = diffMarkets(effective, live);
  return { ops, live, effective };
}

export async function executeMarketsApply(storeId: string, userId: string) {
  const [store] = await db.select().from(schema.stores)
    .where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);
  const applyStore: ApplyStore = {
    id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
    status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
  };
  const live = await readLiveMarkets(applyStore);
  const effective = await buildEffective(storeId);
  const ops = diffMarkets(effective, live);
  const effectiveByHandle = Object.fromEntries(effective.map((e) => [e.handle, e]));
  const applyRunId = crypto.randomUUID();
  return runMarketsApply({
    store: applyStore, applyRunId, ops, effectiveByHandle, dryRun: false,
    deps: buildApplyDeps(userId),
  });
}

export interface BackupApplyAllResult {
  storeId: string;
  storeName: string;
  ok: boolean;
  errors: string[];
}

/** Apply backup (đẩy cấu hình market + flat rates) lên TẤT CẢ store active,
 *  không bảo trì — tuần tự để không dội Shopify. Dùng khi carrier API gãy. */
export async function executeMarketsApplyAll(userId: string): Promise<BackupApplyAllResult[]> {
  const stores = await db.select().from(schema.stores)
    .where(and(eq(schema.stores.status, 'active'), eq(schema.stores.maintenanceMode, false)));
  const out: BackupApplyAllResult[] = [];
  for (const s of stores) {
    try {
      const r = await executeMarketsApply(s.id, userId);
      const errors = r.kind === 'applied' ? r.errors.map((e) => `${e.step}: ${e.error}`) : [];
      out.push({ storeId: s.id, storeName: s.name, ok: errors.length === 0, errors });
    } catch (e) {
      out.push({ storeId: s.id, storeName: s.name, ok: false, errors: [e instanceof Error ? e.message : String(e)] });
    }
  }
  return out;
}

export async function listApplyHistory(storeId: string, limit = 25) {
  return db.select().from(schema.marketApplyHistory)
    .where(eq(schema.marketApplyHistory.storeId, storeId))
    .orderBy(desc(schema.marketApplyHistory.createdAt))
    .limit(limit);
}
