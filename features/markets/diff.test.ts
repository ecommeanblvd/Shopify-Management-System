import { describe, it, expect } from 'vitest';
import { diffMarkets, type MarketOps } from './diff';
import type { EffectiveMarket } from './types';
import type { NormalizedMarket } from './domain/markets';

const eff = (overrides: Partial<EffectiveMarket> = {}): EffectiveMarket => ({
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
  priceAdjustment: null,
  shipping: null,
  ...overrides,
});

const live = (overrides: Partial<NormalizedMarket> = {}): NormalizedMarket => ({
  id: 'gid://shopify/Market/1',
  handle: 'europe',
  name: 'Europe',
  type: 'regional',
  countries: ['DE', 'FR'],
  primaryCurrency: 'EUR',
  alternativeCurrencies: [],
  primaryLanguage: 'en',
  alternativeLanguages: [],
  enabled: true,
  primary: false,
  priceListId: null,
  priceAdjustment: null,
  ...overrides,
});

describe('diffMarkets', () => {
  it('returns empty ops when effective matches live exactly', () => {
    const ops = diffMarkets([eff()], [live()]);
    expect(ops.marketsToCreate).toEqual([]);
    expect(ops.marketsToUpdate).toEqual([]);
    expect(ops.marketsToDelete).toEqual([]);
  });

  it('produces marketsToCreate when effective has handle not in live', () => {
    const ops = diffMarkets([eff({ handle: 'new-market' })], []);
    expect(ops.marketsToCreate).toHaveLength(1);
    expect(ops.marketsToCreate[0].handle).toBe('new-market');
  });

  it('produces marketsToDelete when live has handle not in effective', () => {
    const ops = diffMarkets([], [live({ handle: 'stale-market' })]);
    expect(ops.marketsToDelete).toHaveLength(1);
    expect(ops.marketsToDelete[0].handle).toBe('stale-market');
  });

  it('produces marketsToUpdate when enabled differs', () => {
    const ops = diffMarkets([eff({ enabled: false })], [live({ enabled: true })]);
    expect(ops.marketsToUpdate).toHaveLength(1);
    expect(ops.marketsToUpdate[0].changes).toContain('enabled');
  });

  it('produces marketsToUpdate when name differs', () => {
    const ops = diffMarkets([eff({ name: 'EU' })], [live({ name: 'Europe' })]);
    expect(ops.marketsToUpdate[0].changes).toContain('name');
  });

  it('produces region operations when countries differ', () => {
    const ops = diffMarkets(
      [eff({ countries: ['DE', 'IT'] })],
      [live({ countries: ['DE', 'FR'] })],
    );
    expect(ops.regionsToAdd).toContainEqual({
      marketHandle: 'europe', countryCode: 'IT',
    });
    expect(ops.regionsToRemove).toContainEqual({
      marketHandle: 'europe', countryCode: 'FR',
    });
  });

  it('produces priceListsToCreate when override has adjustment but live has none', () => {
    const ops = diffMarkets(
      [eff({ priceAdjustment: { type: 'percentage', value: 12 } })],
      [live()],
    );
    expect(ops.priceListsToCreate).toHaveLength(1);
    expect(ops.priceListsToCreate[0].marketHandle).toBe('europe');
  });

  it('produces priceListsToUpdate when adjustment value differs', () => {
    const ops = diffMarkets(
      [eff({ priceAdjustment: { type: 'percentage', value: 15 } })],
      [live({
        priceListId: 'gid://PL/1',
        priceAdjustment: { type: 'percentage', value: 12 },
      })],
    );
    expect(ops.priceListsToUpdate).toHaveLength(1);
    expect(ops.priceListsToUpdate[0].priceListId).toBe('gid://PL/1');
  });

  it('produces priceListsToDelete when override removed adjustment', () => {
    const ops = diffMarkets(
      [eff({ priceAdjustment: null })],
      [live({
        priceListId: 'gid://PL/1',
        priceAdjustment: { type: 'percentage', value: 12 },
      })],
    );
    expect(ops.priceListsToDelete).toEqual(['gid://PL/1']);
  });
});
