import { describe, it, expect } from 'vitest';
import {
  buildSnapshot, detectCountryConflicts, detectPrimaryMarketRisk,
} from './reconciliation';
import type { EffectiveMarket } from './types';
import type { NormalizedMarket } from './domain/markets';

const live = (o: Partial<NormalizedMarket> = {}): NormalizedMarket => ({
  id: 'gid://Market/1', handle: 'us', name: 'United States', type: 'regional',
  countries: ['US'], primaryCurrency: 'USD', alternativeCurrencies: [],
  primaryLanguage: 'en', alternativeLanguages: [],
  enabled: true, primary: false, priceListId: null, priceAdjustment: null, ...o,
});

const eff = (o: Partial<EffectiveMarket> = {}): EffectiveMarket => ({
  handle: 'us', name: 'United States', type: 'regional', countries: ['US'],
  primaryCurrency: 'USD', alternativeCurrencies: [],
  primaryLanguage: 'en', alternativeLanguages: [],
  enabled: true, priceAdjustment: null, shipping: null, ...o,
});

describe('buildSnapshot', () => {
  it('returns object with markets, timestamp, shape version', () => {
    const snap = buildSnapshot([live()]);
    expect(snap.markets).toHaveLength(1);
    expect(snap.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(snap.shapeVersion).toBe(1);
  });
});

describe('detectCountryConflicts', () => {
  it('returns empty when no conflicts', () => {
    const conflicts = detectCountryConflicts(
      [eff({ handle: 'us', countries: ['US'] })],
      [live({ handle: 'us', countries: ['US'] })],
    );
    expect(conflicts).toEqual([]);
  });

  it('detects when live has a country in a different market than effective', () => {
    const conflicts = detectCountryConflicts(
      [
        eff({ handle: 'us', countries: ['US'] }),
        eff({ handle: 'canada', countries: ['CA'] }),
      ],
      [
        live({ id: 'gid://M/1', handle: 'us', countries: ['US', 'CA'] }),
        live({ id: 'gid://M/2', handle: 'canada', countries: [] }),
      ],
    );
    expect(conflicts).toEqual([
      { countryCode: 'CA', liveMarketHandle: 'us', effectiveMarketHandle: 'canada' },
    ]);
  });
});

describe('detectPrimaryMarketRisk', () => {
  it('returns risk when effective wants to delete a primary live market', () => {
    const risk = detectPrimaryMarketRisk(
      [eff({ handle: 'eu' })],
      [
        live({ handle: 'us', primary: true }),
        live({ handle: 'eu', primary: false }),
      ],
    );
    expect(risk).toEqual([{ handle: 'us' }]);
  });

  it('returns empty when no primary deletion attempted', () => {
    expect(detectPrimaryMarketRisk(
      [eff({ handle: 'us' })],
      [live({ handle: 'us', primary: true })],
    )).toEqual([]);
  });
});
