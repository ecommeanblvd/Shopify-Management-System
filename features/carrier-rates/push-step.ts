'use server';

import { db, schema } from '@/db/client';
import { getStoreToken, graphqlCall } from '@/lib/shopify/client';
import { hashPayload } from '@/lib/snapshots/snapshots';
import {
  SHIPPING_QUERY, SHIPPING_MUTATION,
  normalizeAllDeliveryProfiles, buildCleanRebuildVariables,
  weightConditionsFromName,
} from '@/features/settings-sync/domain/shipping';
import { buildSystemUpdatePlan, isUpdateOnly, type SystemUpdatePlan, type ZoneUpdate } from './push/system-update-diff';
import {
  requireApplyPermission, loadStore, readProfiles,
  previewSystemShippingToProfiles,
} from '@/features/settings-sync/shipping-profiles-actions';
import { buildSystemShippingTree } from '@/features/markets/system-shipping';
import { filterTreeByRatePrefixes, planPush, type PushSource } from './push-plan';
import { buildParticipant, isVnZone } from './push-engine/plan';
import { engineParticipantIdsToReplace } from './push-engine/participant-ids';
import { registerCarrierService } from './carrier-service-actions';

// Engine paginated read (zone list). Update dùng chung SHIPPING_MUTATION qua send().
const ZONE_Q = `query($id:ID!,$after:String){deliveryProfile(id:$id){profileLocationGroups{locationGroup{id} locationGroupZones(first:5,after:$after){pageInfo{hasNextPage endCursor} edges{node{zone{id name countries{code{countryCode restOfWorld}}} methodDefinitions(first:250){edges{node{id rateProvider{__typename}}}}}}}}}}`;

export type PushCursor =
  | { phase: 'manual-delete' }
  | { phase: 'manual-update'; updateStart: number }
  | { phase: 'manual-create'; zoneStart: number }
  | { phase: 'engine'; shopCursor: string | null; csId: string };

export interface PushStepResult {
  done: boolean;
  cursor: PushCursor | null;              // null when done
  progress: { phase: string; current: number; total: number };
  result: { storeId: string; zoneCreated: number; rateOps: number; engineZones: number; errors: string[] };
}

const CHUNK = 40;
const BATCH = 5;

/** Dựng `profile` cho deliveryProfileUpdate cho MỘT chunk update: zonesToUpdate
 *  (methodDefinitionsToUpdate giá + methodDefinitionsToCreate band thiếu) +
 *  methodDefinitionsToDelete (band dư). Cận trên band → weightConditionsToCreate
 *  qua tên gộp "<upper> kg" (tái dùng weightConditionsFromName). */
export function buildUpdateMutationProfile(
  locationGroupId: string,
  zoneChunk: ZoneUpdate[],
  rateDeletes: string[],
): Record<string, unknown> {
  const zonesToUpdate = zoneChunk.map((z) => {
    const zu: Record<string, unknown> = { id: z.zoneId };
    if (z.updates.length) {
      zu.methodDefinitionsToUpdate = z.updates.map((u) => ({
        id: u.id, rateDefinition: { price: { amount: String(u.price), currencyCode: u.currency } },
      }));
    }
    if (z.creates.length) {
      zu.methodDefinitionsToCreate = z.creates.map((c) => {
        const wc = c.upperKg == null ? [] : weightConditionsFromName(`x (0–${c.upperKg} kg)`);
        return {
          name: c.name,
          rateDefinition: { price: { amount: String(c.price), currencyCode: c.currency } },
          ...(wc.length ? { weightConditionsToCreate: wc } : {}),
        };
      });
    }
    return zu;
  });
  const profile: Record<string, unknown> = { locationGroupsToUpdate: [{ id: locationGroupId, zonesToUpdate }] };
  if (rateDeletes.length) profile.methodDefinitionsToDelete = rateDeletes;
  return profile;
}

interface ZoneCreate {
  name: string;
  countries: Array<{ code: string; includeAllProvinces: boolean }>;
  methodDefinitionsToCreate: unknown[];
}

export async function pushShippingStep(
  input: { storeId: string; sources: PushSource[]; dryRun: boolean },
  cursor: PushCursor | null,
): Promise<PushStepResult> {
  const userId = await requireApplyPermission();
  const { storeId } = input;
  const plan = planPush(input.sources);
  const store = await loadStore(storeId);
  const token = await getStoreToken(store.id);
  const profiles = await readProfiles(store);
  const p = profiles.find((x) => x.isDefault) ?? profiles[0];
  if (!p) {
    return {
      done: true, cursor: null,
      progress: { phase: 'Lỗi', current: 1, total: 1 },
      result: { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: ['Store không có delivery profile nào'] },
    };
  }

  // ── DRY-RUN — single call, no chunking (preview is fast, no mutations).
  if (input.dryRun) {
    let zoneCreated = 0;
    let rateOps = 0;
    if (plan.manualSourcePrefixes.length > 0) {
      const rows = await previewSystemShippingToProfiles(storeId, [p.profileId], plan.manualSourcePrefixes);
      for (const r of rows) { zoneCreated += r.zonesToCreate; rateOps += r.rateOps; }
    }
    return {
      done: true, cursor: null,
      progress: { phase: 'Dry-run', current: 1, total: 1 },
      result: { storeId, zoneCreated, rateOps, engineZones: 0, errors: [] },
    };
  }

  // ── APPLY — chunked. Build per-call.
  const fullTree = await buildSystemShippingTree();
  const manualTree = filterTreeByRatePrefixes(fullTree, plan.manualSourcePrefixes);
  const lgId = p.normalized.shopifyIds.locationGroupId;
  const { id } = buildCleanRebuildVariables(p.normalized, manualTree, lgId);
  // DELETE set = ALL system zones (FULL tree) so non-selected-carrier zones go too.
  const delIds = (buildCleanRebuildVariables(p.normalized, fullTree, lgId).profile.zonesToDelete as string[] | undefined) ?? [];
  // CREATE set = manual-filtered, only zones that carry ≥1 rate.
  const createLg = (buildCleanRebuildVariables(p.normalized, manualTree, lgId).profile.locationGroupsToUpdate as Array<{ id: string; zonesToCreate?: ZoneCreate[] }>)[0];
  const creates: ZoneCreate[] = (createLg.zonesToCreate ?? []).filter((z) => (z.methodDefinitionsToCreate?.length ?? 0) > 0);

  // Shared send with retry — mirrors applySystemShippingToProfiles.
  const TRANSIENT = /internal server error|unexpected response|timeout|429|502|503|504|gateway/i;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const send = async (prof: Record<string, unknown>): Promise<string | null> => {
    let lastErr: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(250 * attempt);
      try {
        const res = await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query: SHIPPING_MUTATION, variables: { id, profile: prof } });
        if ((res as { errors?: unknown }).errors) {
          lastErr = JSON.stringify((res as { errors?: unknown }).errors).slice(0, 200);
          if (TRANSIENT.test(lastErr)) continue;
          return lastErr;
        }
        const ue = (res.data as { deliveryProfileUpdate?: { userErrors?: Array<{ message: string }> } })?.deliveryProfileUpdate?.userErrors;
        return ue && ue.length ? ue.map((e) => e.message).join('; ') : null;
      } catch (e) {
        lastErr = (e as Error).message;
        if (TRANSIENT.test(lastErr)) continue;
        return lastErr;
      }
    }
    return lastErr;
  };

  // READ có retry transient — như send() nhưng cho query đọc. graphqlCall giờ ném
  // lỗi rõ ràng (kèm 502/gateway) khi Shopify trả non-JSON, nên các read nặng
  // (re-fetch profile, list zone engine) không còn crash cả action: retry 5xx,
  // hết lượt thì ném lỗi sạch để call-site gói thành error result.
  const read = async (query: string, variables?: Record<string, unknown>): Promise<{ data: unknown; errors?: unknown }> => {
    let lastErr = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(250 * attempt);
      try {
        return await graphqlCall({ shopDomain: store.shopDomain, apiVersion: store.apiVersion, token, query, variables });
      } catch (e) {
        lastErr = (e as Error).message;
        if (TRANSIENT.test(lastErr)) continue;
        throw e;
      }
    }
    throw new Error(lastErr || 'Shopify read failed');
  };

  // ── Initial cursor — decide first phase.
  if (cursor === null) {
    if (plan.manualSourcePrefixes.length > 0) {
      const updatePlan = buildSystemUpdatePlan(p.normalized, manualTree);
      cursor = isUpdateOnly(updatePlan)
        ? { phase: 'manual-update', updateStart: 0 }
        : { phase: 'manual-delete' };
    } else if (plan.engineCarriers.length) {
      const { carrierServiceId } = await registerCarrierService(store.id);
      cursor = { phase: 'engine', shopCursor: null, csId: carrierServiceId };
    } else {
      return {
        done: true, cursor: null,
        progress: { phase: 'Không có gì để đẩy', current: 1, total: 1 },
        result: { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [] },
      };
    }
  }

  // ── phase 'manual-update' — store khớp cấu trúc: update giá tại chỗ, KHÔNG xoá zone.
  if (cursor.phase === 'manual-update') {
    const updatePlan: SystemUpdatePlan = buildSystemUpdatePlan(p.normalized, manualTree);
    // Snapshot backup trước khi ghi (giống manual-delete).
    if (cursor.updateStart === 0) {
      const snapshotPayload = [{ profileId: p.profileId, name: p.name, normalized: p.normalized }];
      await db.insert(schema.settingsSnapshots).values({
        storeId, domain: 'shipping_system', payload: snapshotPayload as object,
        payloadHash: hashPayload(snapshotPayload), capturedBy: userId,
      });
    }
    const zoneChunk = updatePlan.zoneUpdates.slice(cursor.updateStart, cursor.updateStart + BATCH);
    if (zoneChunk.length) {
      // rateDeletes chỉ gửi 1 lần (ở chunk đầu) để tránh xoá lặp.
      const dels = cursor.updateStart === 0 ? updatePlan.rateDeletes : [];
      const profile = buildUpdateMutationProfile(lgId, zoneChunk, dels);
      const err = await send(profile);
      if (err) {
        return {
          done: true, cursor: null,
          progress: { phase: 'Cập nhật giá', current: cursor.updateStart, total: updatePlan.zoneUpdates.length },
          result: { storeId, zoneCreated: 0, rateOps: updatePlan.counts.updates, engineZones: 0, errors: [`${p.name}: ${err}`] },
        };
      }
    }
    const nextStart = cursor.updateStart + BATCH;
    let nextCursor: PushCursor | null;
    if (nextStart < updatePlan.zoneUpdates.length) {
      nextCursor = { phase: 'manual-update', updateStart: nextStart };
    } else if (plan.engineCarriers.length) {
      const { carrierServiceId } = await registerCarrierService(store.id);
      nextCursor = { phase: 'engine', shopCursor: null, csId: carrierServiceId };
    } else {
      nextCursor = null;
    }
    return {
      done: nextCursor === null, cursor: nextCursor,
      progress: { phase: 'Cập nhật giá', current: Math.min(nextStart, updatePlan.zoneUpdates.length), total: updatePlan.zoneUpdates.length },
      result: { storeId, zoneCreated: 0, rateOps: updatePlan.counts.updates, engineZones: 0, errors: [] },
    };
  }

  // ── phase 'manual-delete' — snapshot then delete all system zones in batches of 5.
  if (cursor.phase === 'manual-delete') {
    const snapshotPayload = [{ profileId: p.profileId, name: p.name, normalized: p.normalized }];
    await db.insert(schema.settingsSnapshots).values({
      storeId, domain: 'shipping_system', payload: snapshotPayload as object,
      payloadHash: hashPayload(snapshotPayload), capturedBy: userId,
    });
    for (let i = 0; i < delIds.length; i += BATCH) {
      const err = await send({ zonesToDelete: delIds.slice(i, i + BATCH) });
      if (err) {
        return {
          done: true, cursor: null,
          progress: { phase: 'Xoá zone cũ', current: i, total: delIds.length },
          result: { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [`${p.name}: ${err}`] },
        };
      }
    }
    return {
      done: false, cursor: { phase: 'manual-create', zoneStart: 0 },
      progress: { phase: 'Xoá zone cũ', current: delIds.length, total: delIds.length },
      result: { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [] },
    };
  }

  // ── phase 'manual-create' — process up to BATCH zones; create first 40 defs, then top up.
  if (cursor.phase === 'manual-create') {
    const { zoneStart } = cursor;
    const batch = creates.slice(zoneStart, zoneStart + BATCH);
    let zoneCreated = 0;
    let rateOps = 0;

    for (const z of batch) {
      const defs = (z.methodDefinitionsToCreate ?? []) as unknown[];
      const err = await send({
        locationGroupsToUpdate: [{ id: lgId, zonesToCreate: [{ ...z, methodDefinitionsToCreate: defs.slice(0, CHUNK) }] }],
      });
      if (err) {
        return {
          done: true, cursor: null,
          progress: { phase: 'Tạo zone', current: zoneStart + zoneCreated, total: creates.length },
          result: { storeId, zoneCreated, rateOps, engineZones: 0, errors: [`${p.name}: ${err}`] },
        };
      }
      zoneCreated += 1;
      rateOps += defs.length;
    }

    // Top up zones with >CHUNK defs — re-fetch to get zone ids by name.
    if (batch.some((z) => ((z.methodDefinitionsToCreate ?? []) as unknown[]).length > CHUNK)) {
      let raw: { data: unknown; errors?: unknown };
      try {
        raw = await read(SHIPPING_QUERY);
      } catch (e) {
        return {
          done: true, cursor: null,
          progress: { phase: 'Tạo zone', current: zoneStart + zoneCreated, total: creates.length },
          result: { storeId, zoneCreated, rateOps, engineZones: 0, errors: [`${p.name}: ${(e as Error).message}`] },
        };
      }
      const refreshed = normalizeAllDeliveryProfiles(raw.data).find((x) => x.profileId === p.profileId);
      const idByName = refreshed?.normalized.shopifyIds.zoneIdByName ?? {};
      for (const z of batch) {
        const defs = (z.methodDefinitionsToCreate ?? []) as unknown[];
        if (defs.length <= CHUNK) continue;
        const zid = idByName[z.name];
        if (!zid) {
          return {
            done: true, cursor: null,
            progress: { phase: 'Tạo zone', current: zoneStart + zoneCreated, total: creates.length },
            result: { storeId, zoneCreated, rateOps, engineZones: 0, errors: [`${p.name}: Không tìm thấy zone "${z.name}" sau khi tạo`] },
          };
        }
        for (let j = CHUNK; j < defs.length; j += CHUNK) {
          const err = await send({ locationGroupsToUpdate: [{ id: lgId, zonesToUpdate: [{ id: zid, methodDefinitionsToCreate: defs.slice(j, j + CHUNK) }] }] });
          if (err) {
            return {
              done: true, cursor: null,
              progress: { phase: 'Tạo zone', current: zoneStart + zoneCreated, total: creates.length },
              result: { storeId, zoneCreated, rateOps, engineZones: 0, errors: [`${p.name}: ${err}`] },
            };
          }
        }
      }
    }

    const nextStart = zoneStart + BATCH;
    let nextCursor: PushCursor | null;
    if (nextStart < creates.length) {
      nextCursor = { phase: 'manual-create', zoneStart: nextStart };
    } else if (plan.engineCarriers.length) {
      const { carrierServiceId } = await registerCarrierService(store.id);
      nextCursor = { phase: 'engine', shopCursor: null, csId: carrierServiceId };
    } else {
      nextCursor = null;
    }
    return {
      done: nextCursor === null, cursor: nextCursor,
      progress: { phase: 'Tạo zone', current: Math.min(nextStart, creates.length), total: creates.length },
      result: { storeId, zoneCreated, rateOps, engineZones: 0, errors: [] },
    };
  }

  // ── phase 'engine' — fetch ONE page of zones and attach engine participant.
  {
    const { shopCursor, csId } = cursor;
    let q: { data: unknown; errors?: unknown };
    try {
      q = await read(ZONE_Q, { id: p.profileId, after: shopCursor });
    } catch (e) {
      return {
        done: true, cursor: null,
        progress: { phase: 'Gắn engine', current: 0, total: 0 },
        result: { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [`${p.name}: ${(e as Error).message}`] },
      };
    }
    const lg = (q.data as { deliveryProfile?: { profileLocationGroups?: Array<{ locationGroup: { id: string }; locationGroupZones: EngineConn }> } })?.deliveryProfile?.profileLocationGroups?.[0];
    if (!lg) {
      return {
        done: true, cursor: null,
        progress: { phase: 'Gắn engine', current: 0, total: 0 },
        result: { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [] },
      };
    }
    const lgId2 = lg.locationGroup.id;
    const conn = lg.locationGroupZones;
    let engineZones = 0;
    const participant = buildParticipant(csId, plan.engineCarriers);

    for (const e of conn.edges) {
      const z = e.node;
      const countries = z.zone.countries.map((c) => c.code);
      if (isVnZone(countries)) continue;
      const oldIds = engineParticipantIdsToReplace(z.methodDefinitions.edges);
      // Dùng send() (có retry 5xx) — SHIPPING_MUTATION nhận methodDefinitionsToDelete
      // + locationGroupsToUpdate; `id` trong send = profileId (cùng default profile).
      const err = await send({
        methodDefinitionsToDelete: oldIds,
        locationGroupsToUpdate: [{ id: lgId2, zonesToUpdate: [{ id: z.zone.id, methodDefinitionsToCreate: [{ name: 'Engine Carrier Rates', active: true, participant }] }] }],
      });
      if (err) {
        return {
          done: true, cursor: null,
          progress: { phase: 'Gắn engine', current: engineZones, total: 0 },
          result: { storeId, zoneCreated: 0, rateOps: 0, engineZones, errors: [`${p.name}: ${err}`] },
        };
      }
      engineZones += 1;
    }

    const next = conn.pageInfo.hasNextPage
      ? { phase: 'engine' as const, shopCursor: conn.pageInfo.endCursor, csId }
      : null;
    return {
      done: next === null, cursor: next,
      progress: { phase: 'Gắn engine', current: engineZones, total: 0 },
      result: { storeId, zoneCreated: 0, rateOps: 0, engineZones, errors: [] },
    };
  }
}

interface EngineConn {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  edges: Array<{
    node: {
      zone: { id: string; name: string; countries: Array<{ code: { countryCode?: string | null; restOfWorld?: boolean | null } }> };
      methodDefinitions: { edges: Array<{ node: { id: string; rateProvider?: { __typename?: string } } }> };
    };
  }>;
}
