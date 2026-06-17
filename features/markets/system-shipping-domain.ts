import type { ShippingTree } from '@/features/settings-sync/domain/shipping';
import type { MarketShipping, MarketStoreOverride } from './types';

export interface SystemShippingRow { marketHandle: string; shipping: MarketShipping; }

/** Lọc override của store nguồn → các dòng seed (chỉ market có shipping). */
export function planSeedRows(overrides: MarketStoreOverride[]): SystemShippingRow[] {
  return overrides
    .filter((o): o is MarketStoreOverride & { shipping: MarketShipping } => o.shipping != null)
    .map((o) => ({ marketHandle: o.marketHandle, shipping: o.shipping }));
}

/** Gộp zones của mọi market hệ thống thành 1 ShippingTree. */
export function mergeSystemShippingRows(rows: SystemShippingRow[]): ShippingTree {
  const zones: ShippingTree['zones'] = {};
  for (const r of rows) if (r.shipping?.zones) Object.assign(zones, r.shipping.zones);
  return { zones };
}
