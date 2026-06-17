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
import { filterTreeByRateNames, filterTreeByRatePrefixes } from '@/features/carrier-rates/push-plan';
import { buildSystemShippingTree } from '@/features/markets/system-shipping';
import { hashPayload } from '@/lib/snapshots/snapshots';
import type { MarketShipping } from '@/features/markets/types';
import {
  SHIPPING_QUERY, SHIPPING_MUTATION,
  normalizeAllDeliveryProfiles, denormalizeToMutationInput, buildProfileUpdateVariables,
  buildCleanRebuildVariables,
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

type PushOpts = { rateNames?: string[] };
function effectiveFor(tree: ShippingTree, opts?: PushOpts): ShippingTree {
  return opts?.rateNames !== undefined ? filterTreeByRateNames(tree, opts.rateNames) : tree;
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
export async function previewShippingToProfiles(storeId: string, profileIds: string[], opts?: PushOpts): Promise<ProfilePushResult[]> {
  await requireApplyPermission();
  const store = await loadStore(storeId);
  const effective = effectiveFor(await buildStoreShippingTree(storeId), opts);
  if (!opts && Object.keys(effective.zones).length === 0) {
    throw new Error('Chưa có bảng giá ship cho store này — chạy Push (Carrier-rates) trước khi đẩy lên profile.');
  }
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  // Replace-mode: khi đẩy theo tên rate, xoá+tạo lại CHÍNH các rate đó (để điều
  // kiện cân mới áp dụng), KHÔNG đụng rate carrier khác.
  const replaceRateNames = opts?.rateNames !== undefined ? new Set(opts.rateNames) : undefined;
  return profiles.filter((p) => selected.has(p.profileId)).map((p) => {
    const diff = denormalizeToMutationInput(p.normalized, effective, replaceRateNames);
    return {
      profileId: p.profileId, name: p.name,
      // Bỏ zone rỗng rate (engine-only → rateNames:[] sinh zone không rate;
      // Shopify từ chối tạo zone không có rate). Chỉ đếm zone có ≥1 rate.
      zonesToCreate: diff.zonesToCreate.filter((z) => z.rates.length > 0).length, zonesToDelete: diff.zonesToDelete.length,
      rateOps: diff.methodDefinitionsToCreate.length + diff.methodDefinitionsToUpdate.length + diff.methodDefinitionsToDelete.length,
      error: null,
    };
  });
}

/** Đẩy CÙNG bảng giá lên các profile được chọn (ghi thật). Profile không chọn
 *  KHÔNG bị đụng. */
export async function applyShippingToProfiles(storeId: string, profileIds: string[], opts?: PushOpts): Promise<ProfilePushResult[]> {
  const userId = await requireApplyPermission();
  const store = await loadStore(storeId);
  const effective = effectiveFor(await buildStoreShippingTree(storeId), opts);
  if (!opts && Object.keys(effective.zones).length === 0) {
    throw new Error('Chưa có bảng giá ship cho store này — chạy Push (Carrier-rates) trước khi đẩy lên profile.');
  }
  const token = await getStoreToken(store.id);
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  // Replace-mode (xem ghi chú ở preview): xoá+tạo lại các rate được chọn theo tên.
  const replaceRateNames = opts?.rateNames !== undefined ? new Set(opts.rateNames) : undefined;
  const results: ProfilePushResult[] = [];
  for (const p of profiles.filter((pp) => selected.has(pp.profileId))) {
    const diff = denormalizeToMutationInput(p.normalized, effective, replaceRateNames);
    const base: ProfilePushResult = {
      profileId: p.profileId, name: p.name,
      // Chỉ đếm zone-create có ≥1 rate (xem ghi chú ở preview).
      zonesToCreate: diff.zonesToCreate.filter((z) => z.rates.length > 0).length, zonesToDelete: diff.zonesToDelete.length,
      rateOps: diff.methodDefinitionsToCreate.length + diff.methodDefinitionsToUpdate.length + diff.methodDefinitionsToDelete.length,
      error: null,
    };
    try {
      const { id, profile } = buildProfileUpdateVariables(p.normalized, effective, p.normalized.shopifyIds.locationGroupId, replaceRateNames);
      // Replace-mode: profile.methodDefinitionsToDelete CHỈ chứa id rate được chọn
      // (recreate-delete) — đây là delete an toàn, PHẢI gửi (PHASE 1 xoá cũ →
      // PHASE 2/3 tạo lại mới với điều kiện cân mới). Không strip nữa.
      const send = async (prof: Record<string, unknown>) => {
        const res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_MUTATION, variables: { id, profile: prof } });
        if ((res as { errors?: unknown }).errors) return JSON.stringify((res as { errors?: unknown }).errors).slice(0, 200);
        const ue = (res.data as { deliveryProfileUpdate?: { userErrors?: Array<{ message: string }> } })?.deliveryProfileUpdate?.userErrors;
        return ue && ue.length ? ue.map((e) => e.message).join('; ') : null;
      };
      const lgIn = (profile.locationGroupsToUpdate as Array<Record<string, unknown>> | undefined)?.[0];
      const lgId = lgIn?.id;
      // Bỏ zone-create không có rate. buildProfileUpdateVariables sinh mỗi entry
      // dạng { name, countries, methodDefinitionsToCreate }; engine-only push
      // (rateNames:[]) tạo zone với methodDefinitionsToCreate rỗng → Shopify từ
      // chối tạo zone không rate. Engine chỉ attach vào zone CÓ SẴN nên tạo zone
      // rỗng là vô nghĩa.
      const zonesToCreate = ((lgIn?.zonesToCreate as Array<Record<string, unknown>> | undefined) ?? [])
        .filter((z) => ((z.methodDefinitionsToCreate as unknown[] | undefined)?.length ?? 0) > 0);
      const zonesToUpdate = (lgIn?.zonesToUpdate as unknown[]) ?? [];

      // PHASE 1 — xoá zone/rate bị thay TRƯỚC (giải phóng nước), tránh va chạm
      // "Region already exists in another zone" khi tạo zone mới cùng nước.
      const delProfile: Record<string, unknown> = {};
      if (profile.zonesToDelete) delProfile.zonesToDelete = profile.zonesToDelete;
      if (profile.methodDefinitionsToDelete) delProfile.methodDefinitionsToDelete = profile.methodDefinitionsToDelete;
      if (Object.keys(delProfile).length) base.error = await send(delProfile);

      // PHASE 2 — cập nhật rate zone giữ lại (gói nhỏ, 1 lần).
      if (!base.error && zonesToUpdate.length) base.error = await send({ locationGroupsToUpdate: [{ id: lgId, zonesToUpdate }] });

      // PHASE 3 — tạo zone mới THEO LÔ 3 (gửi cả 24 zone/1 mutation → Shopify 500).
      for (let i = 0; !base.error && i < zonesToCreate.length; i += 3) {
        base.error = await send({ locationGroupsToUpdate: [{ id: lgId, zonesToCreate: zonesToCreate.slice(i, i + 3) }] });
      }
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

/** Dry-run clean-rebuild bảng hệ thống lên các profile. `sourcePrefixes` lọc
 *  carrier nguồn (FedEx IP / DHL Express) TRƯỚC khi gộp tên. */
export async function previewSystemShippingToProfiles(
  storeId: string, profileIds: string[], sourcePrefixes: string[],
): Promise<ProfilePushResult[]> {
  await requireApplyPermission();
  const store = await loadStore(storeId);
  const systemTree = filterTreeByRatePrefixes(await buildSystemShippingTree(), sourcePrefixes);
  if (Object.keys(systemTree.zones).length === 0) throw new Error('Bảng giá hệ thống trống — chạy seed trước.');
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  return profiles.filter((p) => selected.has(p.profileId)).map((p) => {
    const { profile } = buildCleanRebuildVariables(p.normalized, systemTree, p.normalized.shopifyIds.locationGroupId);
    const lg = (profile.locationGroupsToUpdate as Array<Record<string, unknown>>)[0];
    const creates = ((lg.zonesToCreate as Array<Record<string, unknown>>) ?? []).filter((z) => ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0) > 0);
    return {
      profileId: p.profileId, name: p.name,
      zonesToCreate: creates.length,
      zonesToDelete: ((profile.zonesToDelete as string[]) ?? []).length,
      rateOps: creates.reduce((n, z) => n + ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0), 0),
      error: null,
    };
  });
}

/** Đẩy clean-rebuild bảng hệ thống lên profile (ghi thật). */
export async function applySystemShippingToProfiles(
  storeId: string, profileIds: string[], sourcePrefixes: string[],
): Promise<ProfilePushResult[]> {
  const userId = await requireApplyPermission();
  const store = await loadStore(storeId);
  const systemTree = filterTreeByRatePrefixes(await buildSystemShippingTree(), sourcePrefixes);
  if (Object.keys(systemTree.zones).length === 0) throw new Error('Bảng giá hệ thống trống — chạy seed trước.');
  const token = await getStoreToken(store.id);
  const profiles = await readProfiles(store);
  const selected = new Set(profileIds);
  // Backup state hiện tại của các profile được chọn TRƯỚC khi clean-rebuild xoá zone
  // (khôi phục được nếu push hỏng giữa chừng). Tái dùng cơ chế settings_snapshots.
  const snapshotPayload = profiles
    .filter((pp) => selected.has(pp.profileId))
    .map((pp) => ({ profileId: pp.profileId, name: pp.name, normalized: pp.normalized }));
  await db.insert(schema.settingsSnapshots).values({
    storeId, domain: 'shipping_system', payload: snapshotPayload as object,
    payloadHash: hashPayload(snapshotPayload), capturedBy: userId,
  });
  const results: ProfilePushResult[] = [];
  for (const p of profiles.filter((pp) => selected.has(pp.profileId))) {
    const { id, profile } = buildCleanRebuildVariables(p.normalized, systemTree, p.normalized.shopifyIds.locationGroupId);
    const lg = (profile.locationGroupsToUpdate as Array<Record<string, unknown>>)[0];
    const zonesToCreate = ((lg.zonesToCreate as Array<Record<string, unknown>>) ?? [])
      .filter((z) => ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0) > 0);
    const base: ProfilePushResult = {
      profileId: p.profileId, name: p.name,
      zonesToCreate: zonesToCreate.length,
      zonesToDelete: ((profile.zonesToDelete as string[]) ?? []).length,
      rateOps: zonesToCreate.reduce((n, z) => n + ((z.methodDefinitionsToCreate as unknown[])?.length ?? 0), 0),
      error: null,
    };
    const send = async (prof: Record<string, unknown>) => {
      const res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_MUTATION, variables: { id, profile: prof } });
      if ((res as { errors?: unknown }).errors) return JSON.stringify((res as { errors?: unknown }).errors).slice(0, 200);
      const ue = (res.data as { deliveryProfileUpdate?: { userErrors?: Array<{ message: string }> } })?.deliveryProfileUpdate?.userErrors;
      return ue && ue.length ? ue.map((e) => e.message).join('; ') : null;
    };
    // Zone có thể chứa >100 method-def (mỗi bậc cân/​carrier 1 def) + nhiều nước
    // (AF1 52, LATAM3 55). Gửi nhiều zone/nhiều def cùng lúc → Shopify 5xx ("An
    // unexpected response…"). Nên: tạo TỪNG zone với 1 lô def nhỏ, rồi thêm def
    // còn lại theo lô vào zone đó (re-fetch lấy id). Mỗi mutation ≤ CHUNK def.
    const CHUNK = 40;
    try {
      // PHASE 1 — xoá zone bị thay TRƯỚC (giải phóng nước, tránh "Region already exists").
      if (profile.zonesToDelete) base.error = await send({ zonesToDelete: profile.zonesToDelete });
      // PHASE 2 — tạo từng zone với lô def đầu (1 zone/mutation).
      for (const z of zonesToCreate) {
        if (base.error) break;
        const defs = (z.methodDefinitionsToCreate as unknown[]) ?? [];
        base.error = await send({
          locationGroupsToUpdate: [{ id: lg.id, zonesToCreate: [{ ...z, methodDefinitionsToCreate: defs.slice(0, CHUNK) }] }],
        });
      }
      // PHASE 3 — thêm def còn lại theo lô vào zone vừa tạo (lấy id theo tên qua re-fetch).
      if (!base.error && zonesToCreate.some((z) => ((z.methodDefinitionsToCreate as unknown[]) ?? []).length > CHUNK)) {
        const refreshed = (await readProfiles(store)).find((pp) => pp.profileId === p.profileId);
        const idByName = refreshed?.normalized.shopifyIds.zoneIdByName ?? {};
        for (const z of zonesToCreate) {
          if (base.error) break;
          const defs = (z.methodDefinitionsToCreate as unknown[]) ?? [];
          if (defs.length <= CHUNK) continue;
          const zid = idByName[z.name as string];
          if (!zid) { base.error = `Không tìm thấy zone "${z.name as string}" sau khi tạo`; break; }
          for (let i = CHUNK; !base.error && i < defs.length; i += CHUNK) {
            base.error = await send({ locationGroupsToUpdate: [{ id: lg.id, zonesToUpdate: [{ id: zid, methodDefinitionsToCreate: defs.slice(i, i + CHUNK) }] }] });
          }
        }
      }
    } catch (e) {
      base.error = (e as Error).message;
    }
    results.push(base);
  }
  await recordAudit({
    action: 'shipping.push_system', userId, storeId, featureKey: 'markets',
    target: results.map((r) => r.name).join(', '),
    requestSummary: `Push system shipping → ${results.length} profile`,
    result: results.some((r) => r.error) ? 'error' : 'success',
    errorDetail: results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`).join('; ') || null,
  });
  return results;
}
