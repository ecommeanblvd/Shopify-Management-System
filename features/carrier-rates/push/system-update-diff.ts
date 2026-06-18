import type { NormalizedShipping, ShippingTree } from '@/features/settings-sync/domain/shipping';
import { bandKeyOf, normalizeRateForShopify, parseWeightBand } from '@/features/settings-sync/domain/shipping';

export interface RateUpdate { id: string; price: number; currency: string }
export interface RateCreate { name: string; price: number; currency: string; upperKg: number | null }
export interface ZoneUpdate { zoneId: string; updates: RateUpdate[]; creates: RateCreate[] }
export interface ZoneCreateFull {
  name: string; countries: string[];
  rates: Array<{ name: string; price: number; currency: string; upperKg: number | null }>;
}
export interface SystemUpdatePlan {
  zoneUpdates: ZoneUpdate[];
  zonesToCreate: ZoneCreateFull[];
  zonesToDelete: string[];
  rateDeletes: string[];
  counts: { updates: number; creates: number; zoneCreates: number; zoneDeletes: number; rateDeletes: number };
}

/** Update-only (fast path) khi KHÔNG phải tạo/xoá zone nào. Tạo/xoá band trong
 *  zone đang có vẫn nằm trên fast path (nhẹ). */
export function isUpdateOnly(plan: SystemUpdatePlan): boolean {
  return plan.zonesToCreate.length === 0 && plan.zonesToDelete.length === 0;
}

const sameCountries = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((c) => sb.has(c));
};

/** Đặc tả 1 rate hệ thống → (tên-gộp Shopify, cận-trên-band). */
function mappedRate(rateName: string): { mappedName: string; upper: string; upperKg: number | null } {
  const mappedName = normalizeRateForShopify(rateName).name;
  const band = parseWeightBand(rateName);
  const upperKg = band ? band.upper : null;
  const upper = upperKg == null ? 'flat' : String(Math.round(upperKg * 1000) / 1000);
  return { mappedName, upper, upperKg };
}

export function buildSystemUpdatePlan(current: NormalizedShipping, systemTree: ShippingTree): SystemUpdatePlan {
  const plan: SystemUpdatePlan = {
    zoneUpdates: [], zonesToCreate: [], zonesToDelete: [], rateDeletes: [],
    counts: { updates: 0, creates: 0, zoneCreates: 0, zoneDeletes: 0, rateDeletes: 0 },
  };
  const storeZones = current.tree.zones;
  const sysZones = systemTree.zones ?? {};

  for (const [zoneName, sysZone] of Object.entries(sysZones)) {
    const storeZone = storeZones[zoneName];
    const fullCreate: ZoneCreateFull = {
      name: zoneName, countries: sysZone.countries,
      rates: Object.entries(sysZone.rates).map(([rn, r]) => {
        const m = mappedRate(rn);
        return { name: m.mappedName, price: r.price, currency: r.currency, upperKg: m.upperKg };
      }),
    };

    // Zone mới HOẶC lệch nước → tạo full (+ xoá zone cũ nếu lệch nước).
    if (!storeZone) { plan.zonesToCreate.push(fullCreate); continue; }
    if (!sameCountries(storeZone.countries, sysZone.countries)) {
      plan.zonesToDelete.push(current.shopifyIds.zoneIdByName[zoneName]);
      plan.zonesToCreate.push(fullCreate);
      continue;
    }

    // Zone khớp nước → diff theo band.
    const updates: RateUpdate[] = [];
    const creates: RateCreate[] = [];
    const seenKeys = new Set<string>();
    for (const [rn, r] of Object.entries(sysZone.rates)) {
      const m = mappedRate(rn);
      const key = bandKeyOf(zoneName, m.mappedName, m.upper);
      seenKeys.add(key);
      const existing = current.bandRates[key];
      if (!existing) {
        creates.push({ name: m.mappedName, price: r.price, currency: r.currency, upperKg: m.upperKg });
      } else if (existing.price !== r.price || existing.currency !== r.currency) {
        updates.push({ id: existing.id, price: r.price, currency: r.currency });
      }
    }
    // Band trên store thuộc zone này nhưng KHÔNG còn trong system → xoá.
    const prefix = `${zoneName}.`;
    for (const [k, br] of Object.entries(current.bandRates)) {
      if (k.startsWith(prefix) && !seenKeys.has(k)) plan.rateDeletes.push(br.id);
    }
    if (updates.length || creates.length) plan.zoneUpdates.push({ zoneId: current.shopifyIds.zoneIdByName[zoneName], updates, creates });
  }

  // Union of all countries covered by the system tree.
  const sysCountries = new Set<string>();
  for (const sysZone of Object.values(sysZones)) {
    for (const c of sysZone.countries) sysCountries.add(c);
  }

  // Orphan-zone pass: store zones absent from systemTree whose countries
  // OVERLAP any system country → must delete to avoid double-coverage.
  for (const [zoneName, storeZone] of Object.entries(storeZones)) {
    if (zoneName in sysZones) continue; // already handled above
    const overlaps = storeZone.countries.some((c) => sysCountries.has(c));
    if (overlaps) {
      plan.zonesToDelete.push(current.shopifyIds.zoneIdByName[zoneName]);
    }
  }

  plan.counts = {
    updates: plan.zoneUpdates.reduce((s, z) => s + z.updates.length, 0),
    creates: plan.zoneUpdates.reduce((s, z) => s + z.creates.length, 0),
    zoneCreates: plan.zonesToCreate.length,
    zoneDeletes: plan.zonesToDelete.length,
    rateDeletes: plan.rateDeletes.length,
  };
  return plan;
}
