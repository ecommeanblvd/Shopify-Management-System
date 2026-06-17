import type { ShippingTree } from '@/features/settings-sync/domain/shipping';

export type PushSource = 'fedex_engine' | 'dhl_engine' | 'manual_fedex' | 'manual_dhl';

const MANUAL_RATE_NAME: Record<string, string> = { manual_fedex: 'Standard shipping', manual_dhl: 'Express shipping' };

export interface PushPlan {
  engineCarriers: string[];
  manualRateNames: string[];
  needsZoneSync: boolean;
}

export function planPush(sources: PushSource[]): PushPlan {
  const engineCarriers: string[] = [];
  if (sources.includes('fedex_engine')) engineCarriers.push('fedex');
  if (sources.includes('dhl_engine')) engineCarriers.push('dhl');
  const manualRateNames: string[] = [];
  if (sources.includes('manual_fedex')) manualRateNames.push(MANUAL_RATE_NAME.manual_fedex);
  if (sources.includes('manual_dhl')) manualRateNames.push(MANUAL_RATE_NAME.manual_dhl);
  const needsZoneSync = engineCarriers.length > 0 || manualRateNames.length > 0;
  return { engineCarriers, manualRateNames, needsZoneSync };
}

/** Lọc tree còn rate có tên trong `names`. names rỗng → giữ zone nhưng rates rỗng
 *  (đồng bộ zone-only cho engine). Zone không còn rate (khi names≠rỗng) → bỏ. */
export function filterTreeByRateNames(tree: ShippingTree, names: string[]): ShippingTree {
  const keep = new Set(names);
  const zones: ShippingTree['zones'] = {};
  for (const [zoneName, zone] of Object.entries(tree.zones)) {
    if (names.length === 0) { zones[zoneName] = { countries: zone.countries, rates: {} }; continue; }
    const rates: typeof zone.rates = {};
    for (const [rn, r] of Object.entries(zone.rates)) if (keep.has(rn)) rates[rn] = r;
    if (Object.keys(rates).length > 0) zones[zoneName] = { countries: zone.countries, rates };
  }
  return { zones };
}
