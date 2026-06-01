import { describe, it, expect } from 'vitest';
import { recalcMarket, type CarrierServiceForRecalc } from './recalc';
import type { CarrierAccountSnapshot, ZoneSnap } from '../engine/quote';

function rates(map: Record<number, number>): Map<number, number> {
  return new Map(Object.entries(map).map(([k, v]) => [Number(k), v]));
}

function zoneSnap(label: string, rateByTier: Record<number, number>): ZoneSnap {
  return { label, rateByTierUpper: rates(rateByTier) };
}

function snap(args: {
  zonesByCountry: [string, ZoneSnap][];
  tiers?: number[];
}): CarrierAccountSnapshot {
  return {
    id: 'acc',
    name: 'Test Account',
    costCurrency: 'VND',
    displayCurrency: 'USD',
    fxCostPerDisplay: 26_000,
    weightTiers: (args.tiers ?? [1, 5]).map((u) => ({ upperKg: u })),
    zonesByCountry: new Map(args.zonesByCountry),
    surcharges: [],
    remotePostcodes: new Map(),
  };
}

function svc(carrierKey: string, label: string, s: CarrierAccountSnapshot): CarrierServiceForRecalc {
  return { carrierAccountId: `acc-${carrierKey}`, carrierKey, serviceLabel: label, snapshot: s };
}

describe('recalcMarket — zone splitting by carrier signature', () => {
  it('emits a single zone when all countries share the same carrier zones', () => {
    const dhl = snap({
      zonesByCountry: [
        ['SG', zoneSnap('Zone 1', { 1: 200_000, 5: 600_000 })],
        ['MY', zoneSnap('Zone 1', { 1: 200_000, 5: 600_000 })],
      ],
    });
    const r = recalcMarket({
      marketHandle: 'sea',
      marketName: 'South East Asia',
      countries: ['SG', 'MY'],
      primaryCurrency: 'USD',
      services: [svc('dhl', 'DHL Express', dhl)],
    });
    const keys = Object.keys(r.shipping.zones);
    expect(keys).toEqual(['South East Asia — DHL 1']);
    expect(r.shipping.zones['South East Asia — DHL 1'].countries).toEqual(['SG', 'MY']);
    expect(Object.keys(r.shipping.zones['South East Asia — DHL 1'].rates)).toEqual([
      'DHL Express (0–1 kg)',
      'DHL Express (1–5 kg)',
    ]);
  });

  it('splits into multiple zones when carriers disagree (Middle East worked example)', () => {
    // Middle East: AE/SA/QA/KW/BH/OM/JO are DHL 9, FedEx H
    //              LB/EG                       are DHL 10, FedEx H
    //              IL/TR                       are DHL 10, FedEx F
    const dhl = snap({
      tiers: [1],
      zonesByCountry: [
        ['AE', zoneSnap('Zone 9',  { 1: 500_000 })],
        ['SA', zoneSnap('Zone 9',  { 1: 500_000 })],
        ['LB', zoneSnap('Zone 10', { 1: 700_000 })],
        ['EG', zoneSnap('Zone 10', { 1: 700_000 })],
        ['IL', zoneSnap('Zone 10', { 1: 700_000 })],
        ['TR', zoneSnap('Zone 10', { 1: 700_000 })],
      ],
    });
    const fedex = snap({
      tiers: [1],
      zonesByCountry: [
        ['AE', zoneSnap('Zone H', { 1: 600_000 })],
        ['SA', zoneSnap('Zone H', { 1: 600_000 })],
        ['LB', zoneSnap('Zone H', { 1: 600_000 })],
        ['EG', zoneSnap('Zone H', { 1: 600_000 })],
        ['IL', zoneSnap('Zone F', { 1: 550_000 })],
        ['TR', zoneSnap('Zone F', { 1: 550_000 })],
      ],
    });
    const r = recalcMarket({
      marketHandle: 'middle-east',
      marketName: 'Middle East',
      countries: ['AE', 'SA', 'LB', 'EG', 'IL', 'TR'],
      primaryCurrency: 'USD',
      services: [svc('dhl', 'DHL Express', dhl), svc('fedex', 'FedEx IPE', fedex)],
    });

    const keys = Object.keys(r.shipping.zones).sort();
    expect(keys).toEqual([
      'Middle East — DHL 10 / FedEx F',
      'Middle East — DHL 10 / FedEx H',
      'Middle East — DHL 9 / FedEx H',
    ]);
    expect(r.shipping.zones['Middle East — DHL 9 / FedEx H'].countries).toEqual(['AE', 'SA']);
    expect(r.shipping.zones['Middle East — DHL 10 / FedEx H'].countries).toEqual(['LB', 'EG']);
    expect(r.shipping.zones['Middle East — DHL 10 / FedEx F'].countries).toEqual(['IL', 'TR']);

    // Each zone has BOTH DHL and FedEx rates (2 services × 1 tier = 2 rates per zone)
    for (const zone of Object.values(r.shipping.zones)) {
      expect(Object.keys(zone.rates).sort()).toEqual(['DHL Express (0–1 kg)', 'FedEx IPE (0–1 kg)']);
    }
  });

  it('skips a carrier rate when that carrier does not serve any country in the group', () => {
    // FedEx serves SG but not VN. Both must appear in zones, but only SG zone has FedEx rate.
    const dhl = snap({
      tiers: [1],
      zonesByCountry: [
        ['SG', zoneSnap('Zone 1', { 1: 200_000 })],
        ['VN', zoneSnap('Zone 1', { 1: 200_000 })], // DHL serves VN too
      ],
    });
    const fedex = snap({
      tiers: [1],
      zonesByCountry: [
        ['SG', zoneSnap('Zone Y', { 1: 300_000 })],
        // VN missing
      ],
    });
    const r = recalcMarket({
      marketHandle: 'sea',
      marketName: 'SEA',
      countries: ['SG', 'VN'],
      primaryCurrency: 'USD',
      services: [svc('dhl', 'DHL Express', dhl), svc('fedex', 'FedEx IPE', fedex)],
    });

    const zoneNames = Object.keys(r.shipping.zones);
    expect(zoneNames).toContain('SEA — DHL 1 / FedEx Y');     // SG
    expect(zoneNames).toContain('SEA — DHL 1 / FedEx —');     // VN

    // SG zone has both rates; VN zone has only DHL
    expect(Object.keys(r.shipping.zones['SEA — DHL 1 / FedEx Y'].rates).sort()).toEqual([
      'DHL Express (0–1 kg)',
      'FedEx IPE (0–1 kg)',
    ]);
    expect(Object.keys(r.shipping.zones['SEA — DHL 1 / FedEx —'].rates)).toEqual([
      'DHL Express (0–1 kg)',
    ]);
  });

  it('applies surcharges via the underlying quote engine', () => {
    const dhl = snap({
      tiers: [1],
      zonesByCountry: [['SG', zoneSnap('Zone 1', { 1: 200_000 })]],
    });
    dhl.surcharges = [
      { kind: 'fuel_percent', value: 30, active: true },
      { kind: 'markup_percent', value: 12, active: true },
    ];
    const r = recalcMarket({
      marketHandle: 'sea',
      marketName: 'SEA',
      countries: ['SG'],
      primaryCurrency: 'USD',
      services: [svc('dhl', 'DHL', dhl)],
    });
    // 200_000 + fuel 60_000 = 260_000, markup 12% = 31_200, final 291_200 / 26_000 ≈ 11.20
    const rate = r.shipping.zones['SEA — DHL 1'].rates['DHL (0–1 kg)'];
    expect(rate.price).toBeCloseTo(291_200 / 26_000, 2);
  });

  it('emits zero zones when the market has no countries', () => {
    const r = recalcMarket({
      marketHandle: 'empty',
      marketName: 'Empty',
      countries: [],
      primaryCurrency: 'USD',
      services: [svc('dhl', 'DHL', snap({ zonesByCountry: [] }))],
    });
    expect(Object.keys(r.shipping.zones)).toEqual([]);
  });

  it('groups countries that share the same carrier zones across multiple services', () => {
    // SG and MY both: DHL Zone 1 AND FedEx Zone Q (hypothetical) → ONE zone
    const dhl = snap({
      tiers: [1],
      zonesByCountry: [
        ['SG', zoneSnap('Zone 1', { 1: 200_000 })],
        ['MY', zoneSnap('Zone 1', { 1: 200_000 })],
      ],
    });
    const fedex = snap({
      tiers: [1],
      zonesByCountry: [
        ['SG', zoneSnap('Zone Q', { 1: 300_000 })],
        ['MY', zoneSnap('Zone Q', { 1: 300_000 })],
      ],
    });
    const r = recalcMarket({
      marketHandle: 'sea',
      marketName: 'SEA',
      countries: ['SG', 'MY'],
      primaryCurrency: 'USD',
      services: [svc('dhl', 'DHL', dhl), svc('fedex', 'FedEx', fedex)],
    });
    expect(Object.keys(r.shipping.zones)).toEqual(['SEA — DHL 1 / FedEx Q']);
    expect(r.shipping.zones['SEA — DHL 1 / FedEx Q'].countries).toEqual(['SG', 'MY']);
  });
});
