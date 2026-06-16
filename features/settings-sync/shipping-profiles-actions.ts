'use server';

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { auth } from '@/lib/auth/auth';
import { getRole } from '@/lib/auth/role';
import { hasPermission } from '@/lib/auth/rbac';
import { recordAudit } from '@/lib/logging/audit';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { listOverridesForStore } from '@/features/markets/actions';
import type { MarketShipping } from '@/features/markets/types';
import {
  SHIPPING_QUERY, SHIPPING_MUTATION,
  normalizeAllDeliveryProfiles, denormalizeToMutationInput,
  type ShippingTree, type ProfileSummary,
} from './domain/shipping';

export interface ProfileInfo { profileId: string; name: string; isDefault: boolean; zoneCount: number }

export interface ProfilePushResult {
  profileId: string;
  name: string;
  zonesToCreate: number;
  zonesToDelete: number;
  rateOps: number; // create+update+delete method definitions
  error: string | null;
}

async function requireApplyPermission(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new Error('unauthenticated');
  const role = await getRole(session.user.id);
  if (!role || !hasPermission(role, 'apply_markets')) throw new Error('forbidden');
  return session.user.id;
}

async function loadStore(storeId: string) {
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, storeId)).limit(1);
  if (!store) throw new Error(`Store ${storeId} not found`);
  return store;
}

async function readProfiles(store: { id: string; shopDomain: string; apiVersion: string }): Promise<ProfileSummary[]> {
  const token = await getStoreToken(store.id);
  const raw = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_QUERY });
  if ((raw as { errors?: unknown }).errors) throw new Error(`Shopify: ${JSON.stringify((raw as { errors?: unknown }).errors).slice(0, 200)}`);
  return normalizeAllDeliveryProfiles(raw.data);
}

/** Bảng giá ship hiệu lực của store = gộp zones của mọi market override. */
async function buildStoreShippingTree(storeId: string): Promise<ShippingTree> {
  const overrides = await listOverridesForStore(storeId);
  const zones: ShippingTree['zones'] = {};
  for (const o of overrides) {
    const s = o.shipping as MarketShipping | null;
    if (s?.zones) Object.assign(zones, s.zones);
  }
  return { zones };
}

/** Liệt kê delivery profile của store (cho UI chọn). */
export async function listShippingProfiles(storeId: string): Promise<ProfileInfo[]> {
  const store = await loadStore(storeId);
  const profiles = await readProfiles(store);
  return profiles.map((p) => ({
    profileId: p.profileId, name: p.name, isDefault: p.isDefault,
    zoneCount: Object.keys(p.normalized.tree.zones).length,
  }));
}

/** Tính diff đẩy bảng giá lên các profile được chọn — KHÔNG ghi (dry-run). */
export async function previewShippingToProfiles(storeId: string, profileIds: string[]): Promise<ProfilePushResult[]> {
  await requireApplyPermission();
  const store = await loadStore(storeId);
  const effective = await buildStoreShippingTree(storeId);
  if (Object.keys(effective.zones).length === 0) {
    throw new Error('Chưa có bảng giá ship cho store này — chạy Push (Carrier-rates) trước khi đẩy lên profile.');
  }
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  return profiles.filter((p) => selected.has(p.profileId)).map((p) => {
    const diff = denormalizeToMutationInput(p.normalized, effective);
    return {
      profileId: p.profileId, name: p.name,
      zonesToCreate: diff.zonesToCreate.length, zonesToDelete: diff.zonesToDelete.length,
      rateOps: diff.methodDefinitionsToCreate.length + diff.methodDefinitionsToUpdate.length + diff.methodDefinitionsToDelete.length,
      error: null,
    };
  });
}

/** Đẩy CÙNG bảng giá lên các profile được chọn (ghi thật). Profile không chọn
 *  KHÔNG bị đụng. */
export async function applyShippingToProfiles(storeId: string, profileIds: string[]): Promise<ProfilePushResult[]> {
  const userId = await requireApplyPermission();
  const store = await loadStore(storeId);
  const effective = await buildStoreShippingTree(storeId);
  if (Object.keys(effective.zones).length === 0) {
    throw new Error('Chưa có bảng giá ship cho store này — chạy Push (Carrier-rates) trước khi đẩy lên profile.');
  }
  const token = await getStoreToken(store.id);
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  const results: ProfilePushResult[] = [];
  for (const p of profiles.filter((pp) => selected.has(pp.profileId))) {
    const diff = denormalizeToMutationInput(p.normalized, effective);
    const base: ProfilePushResult = {
      profileId: p.profileId, name: p.name,
      zonesToCreate: diff.zonesToCreate.length, zonesToDelete: diff.zonesToDelete.length,
      rateOps: diff.methodDefinitionsToCreate.length + diff.methodDefinitionsToUpdate.length + diff.methodDefinitionsToDelete.length,
      error: null,
    };
    try {
      const res = await graphqlCall({
        shopDomain: store.shopDomain, apiVersion: store.apiVersion, token,
        query: SHIPPING_MUTATION, variables: { id: p.profileId, profile: diff },
      });
      const errs = (res.data as { deliveryProfileUpdate?: { userErrors?: Array<{ message: string }> } })?.deliveryProfileUpdate?.userErrors;
      if ((res as { errors?: unknown }).errors) base.error = JSON.stringify((res as { errors?: unknown }).errors).slice(0, 200);
      else if (errs && errs.length) base.error = errs.map((e) => e.message).join('; ');
    } catch (e) {
      base.error = (e as Error).message;
    }
    results.push(base);
  }
  await recordAudit({
    action: 'shipping.push_profiles', userId, storeId, featureKey: 'markets',
    target: results.map((r) => r.name).join(', '),
    requestSummary: `Push shipping → ${results.length} profile`,
    result: results.some((r) => r.error) ? 'error' : 'success',
    errorDetail: results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`).join('; ') || null,
  });
  return results;
}
