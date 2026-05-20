'use server';

import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { runQuery } from '@/lib/shopify/connector';
import { runMutation } from '@/lib/shopify/writer';
import { isFeatureEnabled } from '@/lib/flags/flags';
import { recordAudit } from '@/lib/logging/audit';
import { hashPayload } from '@/lib/snapshots/snapshots';
import { settingsSyncManifest } from './manifest';
import { runApplyForStore, type ApplyDeps, type ApplyStore, type DomainAdapter } from './apply';
import {
  SHIPPING_QUERY, SHIPPING_MUTATION,
  normalizeShopifyDeliveryProfile, denormalizeToMutationInput,
} from './domain/shipping';
import {
  BUYER_EXPERIENCE_QUERY, BUYER_EXPERIENCE_MUTATION,
  normalizeBuyerExperience, denormalizeBuyerExperience,
} from './domain/checkout-buyer-experience';

type Domain = 'shipping' | 'checkout_buyer_experience';

const SHIPPING_ADAPTER: DomainAdapter = {
  fetchQuery: SHIPPING_QUERY,
  normalize: (data) => {
    const n = normalizeShopifyDeliveryProfile(data);
    return { tree: n.tree as unknown as Record<string, unknown>, shopifyIds: n.shopifyIds as unknown as Record<string, unknown> };
  },
  buildMutation: (current, effective) => {
    const input = denormalizeToMutationInput(
      { tree: current.tree as never, shopifyIds: current.shopifyIds as never },
      effective as never,
    );
    return { mutation: SHIPPING_MUTATION, variables: { id: input.profileId, profile: input } };
  },
};

const BUYER_EXP_ADAPTER: DomainAdapter = {
  fetchQuery: BUYER_EXPERIENCE_QUERY,
  normalize: (data) => ({ tree: normalizeBuyerExperience(data) as unknown as Record<string, unknown>, shopifyIds: {} }),
  buildMutation: (current, effective) => {
    const diff = denormalizeBuyerExperience(current.tree as never, effective as never);
    return { mutation: BUYER_EXPERIENCE_MUTATION, variables: { input: diff } };
  },
};

function adapterFor(domain: Domain): DomainAdapter {
  return domain === 'shipping' ? SHIPPING_ADAPTER : BUYER_EXP_ADAPTER;
}

export async function getLatestTemplate(domain: Domain) {
  const [row] = await db
    .select()
    .from(schema.settingTemplates)
    .where(eq(schema.settingTemplates.domain, domain))
    .orderBy(desc(schema.settingTemplates.version))
    .limit(1);
  return row ?? null;
}

export async function saveTemplate(domain: Domain, payload: unknown, userId: string) {
  const latest = await getLatestTemplate(domain);
  const nextVersion = (latest?.version ?? 0) + 1;
  const [row] = await db
    .insert(schema.settingTemplates)
    .values({ domain, payload: payload as object, version: nextVersion, createdBy: userId })
    .returning();
  return row;
}

export async function listOverrides(storeId: string, domain: Domain) {
  return db
    .select()
    .from(schema.settingOverrides)
    .where(and(eq(schema.settingOverrides.storeId, storeId), eq(schema.settingOverrides.domain, domain)));
}

export async function isStoreReconciled(storeId: string, domain: Domain): Promise<boolean> {
  const [row] = await db
    .select()
    .from(schema.reconciliationStatus)
    .where(and(eq(schema.reconciliationStatus.storeId, storeId), eq(schema.reconciliationStatus.domain, domain)))
    .limit(1);
  return row?.status === 'reconciled';
}

export async function setStoreReconciled(storeId: string, domain: Domain, userId: string) {
  const existing = await db
    .select()
    .from(schema.reconciliationStatus)
    .where(and(eq(schema.reconciliationStatus.storeId, storeId), eq(schema.reconciliationStatus.domain, domain)))
    .limit(1);
  if (existing[0]) {
    await db
      .update(schema.reconciliationStatus)
      .set({ status: 'reconciled', reconciledAt: new Date(), reconciledBy: userId })
      .where(eq(schema.reconciliationStatus.id, existing[0].id));
  } else {
    await db.insert(schema.reconciliationStatus).values({
      storeId, domain, status: 'reconciled', reconciledAt: new Date(), reconciledBy: userId,
    });
  }
}

async function captureSnapshot(args: { storeId: string; domain: string; payload: unknown; applyRunId: string }) {
  await db.insert(schema.settingsSnapshots).values({
    storeId: args.storeId,
    domain: args.domain,
    payload: args.payload as object,
    payloadHash: hashPayload(args.payload),
    applyRunId: args.applyRunId,
  });
}

function buildApplyDeps(userId: string | null): ApplyDeps {
  return {
    isReconciled: (storeId, domain) => isStoreReconciled(storeId, domain as Domain),
    readCurrent: async (store, query) => {
      return runQuery({
        store: { id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion, status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes },
        featureKey: settingsSyncManifest.key,
        requiredScopes: settingsSyncManifest.requiredScopes,
        query,
        deps: {
          isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
          graphql: ({ shopDomain, apiVersion, token, query: q, variables }) =>
            graphqlCall({ shopDomain, apiVersion, token, query: q, variables }),
          decryptToken: getStoreToken,
        },
      });
    },
    captureSnapshot,
    listOverrides: async (storeId, domain) => {
      const rows = await listOverrides(storeId, domain as Domain);
      return rows.map((r) => ({ path: r.path, value: r.value }));
    },
    runMutation: async ({ store, applyRunId, domain, mutation, variables }) => {
      return runMutation({
        store: store as ApplyStore,
        featureKey: settingsSyncManifest.key,
        requiredScopes: settingsSyncManifest.requiredScopes,
        applyRunId,
        domain,
        mutation,
        variables,
        deps: {
          isEnabled: (fk, sid) => isFeatureEnabled(fk, sid),
          isReconciled: (sid, d) => isStoreReconciled(sid, d as Domain),
          hasSnapshot: async (sid, d, runId) => {
            const [row] = await db.select().from(schema.settingsSnapshots).where(and(
              eq(schema.settingsSnapshots.storeId, sid),
              eq(schema.settingsSnapshots.domain, d),
              eq(schema.settingsSnapshots.applyRunId, runId),
            )).limit(1);
            return !!row;
          },
          manifestHasWriteOps: () => settingsSyncManifest.hasWriteOperations,
          graphql: ({ shopDomain, apiVersion, token, mutation: m, variables: v }) =>
            graphqlCall({ shopDomain, apiVersion, token, query: m, variables: v }),
          decryptToken: getStoreToken,
        },
      });
    },
    recordAudit: async (entry) =>
      recordAudit({
        userId,
        storeId: entry.storeId,
        featureKey: settingsSyncManifest.key,
        action: entry.action,
        target: entry.domain,
        requestSummary: entry.requestSummary ?? null,
        result: entry.result,
        errorDetail: entry.errorDetail ?? null,
      }),
  };
}

export async function previewApply(
  storeId: string,
  domain: Domain,
  templateVersion: number,
) {
  const [template] = await db.select().from(schema.settingTemplates).where(
    and(eq(schema.settingTemplates.domain, domain), eq(schema.settingTemplates.version, templateVersion)),
  ).limit(1);
  if (!template) throw new Error(`Template ${domain} v${templateVersion} not found`);
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);

  const applyStore: ApplyStore = {
    id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
    status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
  };

  return runApplyForStore({
    store: applyStore,
    applyRunId: 'preview',
    domain,
    template: template.payload as Record<string, unknown>,
    adapter: adapterFor(domain),
    dryRun: true,
    deps: buildApplyDeps(null),
  });
}

export async function executeApply(
  storeIds: string[],
  domain: Domain,
  templateVersion: number,
  userId: string,
) {
  const [template] = await db.select().from(schema.settingTemplates).where(
    and(eq(schema.settingTemplates.domain, domain), eq(schema.settingTemplates.version, templateVersion)),
  ).limit(1);
  if (!template) throw new Error(`Template ${domain} v${templateVersion} not found`);

  const [run] = await db.insert(schema.applyRuns).values({
    templateId: template.id,
    domain,
    targetStoreIds: storeIds,
    status: 'in_progress',
    startedBy: userId,
  }).returning();

  const summary: Record<string, unknown> = {};
  const deps = buildApplyDeps(userId);

  for (const storeId of storeIds) {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
    if (!store) {
      summary[storeId] = { status: 'skipped', reason: 'store not found' };
      continue;
    }
    const applyStore: ApplyStore = {
      id: store.id, shopDomain: store.shopDomain, apiVersion: store.apiVersion,
      status: store.status, maintenanceMode: store.maintenanceMode, scopes: store.scopes,
    };
    try {
      const result = await runApplyForStore({
        store: applyStore, applyRunId: run.id, domain,
        template: template.payload as Record<string, unknown>,
        adapter: adapterFor(domain), dryRun: false, deps,
      });
      summary[storeId] = { status: 'success', ops: { creates: result.ops.creates.length, updates: result.ops.updates.length, deletes: result.ops.deletes.length } };
    } catch (err) {
      summary[storeId] = { status: 'error', error: String(err) };
      await db.update(schema.applyRuns).set({
        status: 'partial', finishedAt: new Date(), summary,
      }).where(eq(schema.applyRuns.id, run.id));
      return run;
    }
  }

  await db.update(schema.applyRuns).set({
    status: 'success', finishedAt: new Date(), summary,
  }).where(eq(schema.applyRuns.id, run.id));
  return run;
}
