import { describe, it, expect } from 'vitest';
import { planPush, filterTreeByRateNames, filterTreeByRatePrefixes, type PushSource } from './push-plan';

describe('planPush', () => {
  it('map nguồn → rate name manual + carrier engine', () => {
    const p = planPush(['fedex_engine', 'manual_fedex'] as PushSource[]);
    expect(p.engineCarriers).toEqual(['fedex']);
    expect(p.manualRateNames).toEqual(['Standard shipping']);
    expect(p.needsZoneSync).toBe(true);
  });
  it('manual DHL → Express shipping; DHL engine → dhl', () => {
    const p = planPush(['dhl_engine', 'manual_dhl'] as PushSource[]);
    expect(p.engineCarriers).toEqual(['dhl']);
    expect(p.manualRateNames).toEqual(['Express shipping']);
  });
  it('chỉ engine (không manual) → manualRateNames rỗng, vẫn needsZoneSync (zone-only)', () => {
    const p = planPush(['fedex_engine'] as PushSource[]);
    expect(p.manualRateNames).toEqual([]);
    expect(p.engineCarriers).toEqual(['fedex']);
    expect(p.needsZoneSync).toBe(true);
  });
  it('rỗng → không cần gì', () => {
    const p = planPush([]);
    expect(p.needsZoneSync).toBe(false);
    expect(p.engineCarriers).toEqual([]);
  });
});

describe('filterTreeByRateNames', () => {
  const tree = {
    zones: {
      'Zone A': { countries: ['US'], rates: { 'Standard shipping': { type: 'flat', price: 10, currency: 'USD' }, 'Express shipping': { type: 'flat', price: 20, currency: 'USD' } } },
      'Zone B': { countries: ['SG'], rates: { 'Express shipping': { type: 'flat', price: 30, currency: 'USD' } } },
    },
  };
  it('giữ chỉ rate tên được chọn; zone không còn rate → bỏ', () => {
    const out = filterTreeByRateNames(tree as never, ['Standard shipping']);
    expect(Object.keys(out.zones)).toEqual(['Zone A']);
    expect(Object.keys(out.zones['Zone A'].rates)).toEqual(['Standard shipping']);
  });
  it('names rỗng → zone giữ nguyên countries nhưng rates rỗng (zone-only sync)', () => {
    const out = filterTreeByRateNames(tree as never, []);
    expect(Object.keys(out.zones).sort()).toEqual(['Zone A', 'Zone B']);
    expect(out.zones['Zone A'].rates).toEqual({});
  });
});

describe('manualSourcePrefixes', () => {
  it('manual_fedex → prefix FedEx IP; manual_dhl → DHL Express', () => {
    expect(planPush(['manual_fedex']).manualSourcePrefixes).toEqual(['FedEx IP']);
    expect(planPush(['manual_dhl']).manualSourcePrefixes).toEqual(['DHL Express']);
    expect(planPush(['manual_fedex', 'manual_dhl']).manualSourcePrefixes).toEqual(['FedEx IP', 'DHL Express']);
  });
});

describe('filterTreeByRatePrefixes', () => {
  const tree = { zones: { Z1: { countries: ['HK'], rates: {
    'FedEx IP (0–0.5 kg)': { type: 'flat', price: 10, currency: 'USD' },
    'DHL Express (0–0.5 kg)': { type: 'flat', price: 12, currency: 'USD' },
  } } } } as const;
  it('giữ rate khớp prefix, bỏ rate khác', () => {
    const out = filterTreeByRatePrefixes(tree as never, ['FedEx IP']);
    expect(Object.keys(out.zones.Z1.rates)).toEqual(['FedEx IP (0–0.5 kg)']);
  });
  it('prefixes rỗng → giữ nguyên', () => {
    expect(filterTreeByRatePrefixes(tree as never, [])).toEqual(tree);
  });
});
