import type { EffectiveMarket, MarketPriceAdjustment } from './types';
import type { NormalizedMarket } from './domain/markets';

export interface MarketOps {
  marketsToCreate: EffectiveMarket[];
  marketsToUpdate: Array<{ liveId: string; effective: EffectiveMarket; changes: string[] }>;
  marketsToDelete: Array<{ liveId: string; handle: string; primary: boolean }>;
  regionsToAdd: Array<{ marketHandle: string; countryCode: string }>;
  regionsToRemove: Array<{ marketHandle: string; countryCode: string }>;
  currencyUpdates: Array<{ liveId: string; primary: string; alternatives: string[] }>;
  languageUpdates: Array<{ liveId: string; defaultLocale: string; alternateLocales: string[] }>;
  priceListsToCreate: Array<{ marketHandle: string; adjustment: MarketPriceAdjustment }>;
  priceListsToUpdate: Array<{ priceListId: string; marketHandle: string; adjustment: MarketPriceAdjustment }>;
  priceListsToDelete: string[];
}

function emptyOps(): MarketOps {
  return {
    marketsToCreate: [],
    marketsToUpdate: [],
    marketsToDelete: [],
    regionsToAdd: [],
    regionsToRemove: [],
    currencyUpdates: [],
    languageUpdates: [],
    priceListsToCreate: [],
    priceListsToUpdate: [],
    priceListsToDelete: [],
  };
}

function arraysEqualSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((x) => set.has(x));
}

export function diffMarkets(
  effective: EffectiveMarket[],
  live: NormalizedMarket[],
): MarketOps {
  const ops = emptyOps();
  const liveByHandle = new Map(live.map((m) => [m.handle, m] as const));
  const effByHandle = new Map(effective.map((m) => [m.handle, m] as const));

  for (const e of effective) {
    const l = liveByHandle.get(e.handle);
    if (!l) {
      ops.marketsToCreate.push(e);
      continue;
    }

    const changes: string[] = [];
    if (e.name !== l.name) changes.push('name');
    if (e.enabled !== l.enabled) changes.push('enabled');
    if (changes.length > 0) {
      ops.marketsToUpdate.push({ liveId: l.id, effective: e, changes });
    }

    for (const c of e.countries) {
      if (!l.countries.includes(c)) {
        ops.regionsToAdd.push({ marketHandle: e.handle, countryCode: c });
      }
    }
    for (const c of l.countries) {
      if (!e.countries.includes(c)) {
        ops.regionsToRemove.push({ marketHandle: e.handle, countryCode: c });
      }
    }

    if (
      e.primaryCurrency !== l.primaryCurrency ||
      !arraysEqualSet(e.alternativeCurrencies, l.alternativeCurrencies)
    ) {
      ops.currencyUpdates.push({
        liveId: l.id,
        primary: e.primaryCurrency,
        alternatives: e.alternativeCurrencies,
      });
    }

    if (
      e.primaryLanguage !== l.primaryLanguage ||
      !arraysEqualSet(e.alternativeLanguages, l.alternativeLanguages)
    ) {
      ops.languageUpdates.push({
        liveId: l.id,
        defaultLocale: e.primaryLanguage,
        alternateLocales: e.alternativeLanguages,
      });
    }

    // Price adjustment ops
    if (e.priceAdjustment && !l.priceListId) {
      ops.priceListsToCreate.push({
        marketHandle: e.handle,
        adjustment: e.priceAdjustment,
      });
    } else if (
      e.priceAdjustment && l.priceListId &&
      (l.priceAdjustment?.value !== e.priceAdjustment.value)
    ) {
      ops.priceListsToUpdate.push({
        priceListId: l.priceListId,
        marketHandle: e.handle,
        adjustment: e.priceAdjustment,
      });
    } else if (!e.priceAdjustment && l.priceListId) {
      ops.priceListsToDelete.push(l.priceListId);
    }
  }

  for (const l of live) {
    if (!effByHandle.has(l.handle)) {
      ops.marketsToDelete.push({ liveId: l.id, handle: l.handle, primary: l.primary });
    }
  }

  return ops;
}
