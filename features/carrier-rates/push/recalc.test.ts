import { describe, it, expect } from 'vitest';
import { recalcMarket, type CarrierServiceForRecalc } from './recalc';
import type { CarrierAccountSnapshot } from '../engine/quote';

function snap(overrides: Partial<CarrierAccountSnapshot> = {}): CarrierAccountSnapshot {
  const cheapRates = new Map<number, number>([[1, 200_000], [5, 600_000]]);
  const expensiveRates = new Map<number, number>([[1, 280_000], [5, 800_000]]);
  return {
    id: 'acc',
    costCurrency: 'VND',
    displayCurrency: 'USD',
    fxCostPerDisplay: 26_000,
    weightTiers: [{ upperKg: 1 }, { upperKg: 5 }],
    zonesByCountry: new Map([
      ['SG', { label: 'Zone 1', rateByTierUpper: cheapRates }],
      ['MY', { label: 'Zone 1', rateByTierUpper: cheapRates }],
      ['CN', { label: 'Zone 5', rateByTierUpper: expensiveRates }],
    ]),
    surcharges: [],
    remotePostcodes: new Map(),
    ...overrides,
  };
}

function svc(label: string, s: CarrierAccountSnapshot): CarrierServiceForRecalc {
  return { carrierAccountId: 'acc', serviceLabel: label, snapshot: s };
}

describe('recalcMarket', () => {
  it('emits one rate per tier × service in MarketShipping shape', () => {
    const r = recalcMarket({
      marketHandle: 'south-east-asia',
      countries: ['SG', 'MY'],
      primaryCurrency: 'USD',
      services: [svc('DHL Express', snap())],
    });
    const zone = r.shipping.zones['south-east-asia'];
    expect(zone).toBeDefined();
    expect(zone.countries).toEqual(['SG', 'MY']);
    expect(Object.keys(zone.rates)).toEqual([
      'DHL Express (0–1 kg)',
      'DHL Express (1–5 kg)',
    ]);
    const rate = zone.rates['DHL Express (0–1 kg)'];
    expect(rate.type).toBe('flat');
    expect(rate.currency).toBe('USD');
    // Engine rounds display to 2 decimals: 200,000 / 26,000 = 7.6923… → 7.69
    expect(rate.price).toBeCloseTo(7.69, 2);
    expect(r.breakdown).toHaveLength(2);
    expect(r.breakdown[0].representativeCountry).toBeDefined();
  });

  it('picks the cheapest country across a multi-zone market', () => {
    const r = recalcMarket({
      marketHandle: 'asia',
      countries: ['CN', 'SG'], // CN is Zone 5 (expensive), SG is Zone 1 (cheap)
      primaryCurrency: 'USD',
      services: [svc('DHL', snap())],
    });
    // SG should win for both tiers
    expect(r.breakdown.every((b) => b.representativeCountry === 'SG')).toBe(true);
  });

  it('stacks multiple services into the same zone', () => {
    const dhl = snap();
    const fedex = snap({
      zonesByCountry: new Map([
        ['SG', { label: 'Zone Y', rateByTierUpper: new Map([[1, 250_000], [5, 700_000]]) }],
      ]),
    });
    const r = recalcMarket({
      marketHandle: 'sea',
      countries: ['SG'],
      primaryCurrency: 'USD',
      services: [svc('DHL', dhl), svc('FedEx IPE', fedex)],
    });
    const names = Object.keys(r.shipping.zones['sea'].rates);
    expect(names).toContain('DHL (0–1 kg)');
    expect(names).toContain('FedEx IPE (0–1 kg)');
    expect(names).toHaveLength(4);
  });

  it('warns when no country in the market is zoned for the carrier', () => {
    const r = recalcMarket({
      marketHandle: 'mars',
      countries: ['ZZ'], // unmapped
      primaryCurrency: 'USD',
      services: [svc('DHL', snap())],
    });
    expect(Object.keys(r.shipping.zones['mars'].rates)).toHaveLength(0);
    expect(r.breakdown.every((b) => b.warning !== null)).toBe(true);
    expect(r.breakdown[0].warning).toMatch(/no_zone|no zoned/);
  });

  it('warns when the market has no countries', () => {
    const r = recalcMarket({
      marketHandle: 'empty',
      countries: [],
      primaryCurrency: 'USD',
      services: [svc('DHL', snap())],
    });
    expect(r.breakdown.every((b) => b.warning === 'market has no countries')).toBe(true);
    expect(Object.keys(r.shipping.zones['empty'].rates)).toHaveLength(0);
  });

  it('applies active fuel + markup across the recalc tier set', () => {
    const s = snap({
      surcharges: [
        { kind: 'fuel_percent', value: 30, active: true },
        { kind: 'markup_percent', value: 12, active: true },
      ],
    });
    const r = recalcMarket({
      marketHandle: 'sea',
      countries: ['SG'],
      primaryCurrency: 'USD',
      services: [svc('DHL', s)],
    });
    // Base 200,000 → fuel 60,000 → subtotal 260,000 → markup 31,200 → 291,200 / 26,000
    const expected = 291_200 / 26_000;
    expect(r.shipping.zones['sea'].rates['DHL (0–1 kg)'].price).toBeCloseTo(expected, 4);
  });
});
