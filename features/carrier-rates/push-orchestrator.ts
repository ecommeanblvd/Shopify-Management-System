'use server';

import { planPush, type PushSource } from './push-plan';
import { previewShippingToProfiles, applyShippingToProfiles, listShippingProfiles } from '@/features/settings-sync/shipping-profiles-actions';
import { pushCarrierRates } from './push-engine/actions';

export interface PushStoreResult {
  storeId: string;
  zoneCreated: number;
  rateOps: number;
  engineZones: number;
  errors: string[];
}

export async function pushShippingToStores(
  input: { storeIds: string[]; sources: PushSource[]; dryRun: boolean },
): Promise<PushStoreResult[]> {
  const plan = planPush(input.sources);
  const out: PushStoreResult[] = [];
  for (const storeId of input.storeIds) {
    const res: PushStoreResult = { storeId, zoneCreated: 0, rateOps: 0, engineZones: 0, errors: [] };
    try {
      // 1) Zone + manual (additive, lọc theo nguồn). Cần khi có manual HOẶC engine
      //    (engine cần zone tồn tại → đẩy zone-only rateNames=[]).
      if (plan.needsZoneSync) {
        const profiles = await listShippingProfiles(storeId);
        const ids = profiles.map((p) => p.profileId);
        const opts = { rateNames: plan.manualRateNames, additive: true };
        const rows = input.dryRun
          ? await previewShippingToProfiles(storeId, ids, opts)
          : await applyShippingToProfiles(storeId, ids, opts);
        for (const r of rows) {
          res.zoneCreated += r.zonesToCreate;
          res.rateOps += r.rateOps;
          if (r.error) res.errors.push(`${r.name}: ${r.error}`);
        }
      }
      // 2) Engine (tự đăng ký CarrierService khi apply)
      if (plan.engineCarriers.length) {
        const r = await pushCarrierRates({ storeId, carriers: plan.engineCarriers, withBackup: false, dryRun: input.dryRun });
        res.engineZones = r.zonesTargeted;
      }
    } catch (e) {
      res.errors.push((e as Error).message);
    }
    out.push(res);
  }
  return out;
}
