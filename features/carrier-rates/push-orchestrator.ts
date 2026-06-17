'use server';

import { planPush, type PushSource } from './push-plan';
import { previewSystemShippingToProfiles, applySystemShippingToProfiles, listShippingProfiles } from '@/features/settings-sync/shipping-profiles-actions';
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
      // 1) Clean-rebuild bảng giá HỆ THỐNG (zone kết hợp + tên rate gộp). Lọc carrier
      //    nguồn theo prefix (FedEx IP / DHL Express).
      if (plan.manualSourcePrefixes.length > 0) {
        const profiles = await listShippingProfiles(storeId);
        const ids = profiles.map((p) => p.profileId);
        const rows = input.dryRun
          ? await previewSystemShippingToProfiles(storeId, ids, plan.manualSourcePrefixes)
          : await applySystemShippingToProfiles(storeId, ids, plan.manualSourcePrefixes);
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
