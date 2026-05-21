import type { EffectiveMarket } from './types';
import type { NormalizedMarket } from './domain/markets';

export interface MarketSnapshot {
  shapeVersion: 1;
  capturedAt: string;
  markets: NormalizedMarket[];
}

export function buildSnapshot(live: NormalizedMarket[]): MarketSnapshot {
  return {
    shapeVersion: 1,
    capturedAt: new Date().toISOString(),
    markets: live,
  };
}

export interface CountryConflict {
  countryCode: string;
  liveMarketHandle: string;
  effectiveMarketHandle: string;
}

export function detectCountryConflicts(
  effective: EffectiveMarket[],
  live: NormalizedMarket[],
): CountryConflict[] {
  const effOwner = new Map<string, string>();
  for (const e of effective) {
    for (const c of e.countries) effOwner.set(c, e.handle);
  }
  const conflicts: CountryConflict[] = [];
  for (const l of live) {
    for (const c of l.countries) {
      const effHandle = effOwner.get(c);
      if (effHandle && effHandle !== l.handle) {
        conflicts.push({
          countryCode: c,
          liveMarketHandle: l.handle,
          effectiveMarketHandle: effHandle,
        });
      }
    }
  }
  return conflicts;
}

export interface PrimaryMarketRisk {
  handle: string;
}

export function detectPrimaryMarketRisk(
  effective: EffectiveMarket[],
  live: NormalizedMarket[],
): PrimaryMarketRisk[] {
  const effHandles = new Set(effective.map((e) => e.handle));
  return live
    .filter((l) => l.primary && !effHandles.has(l.handle))
    .map((l) => ({ handle: l.handle }));
}
