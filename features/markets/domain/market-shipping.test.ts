import { describe, it, expect } from 'vitest';
import {
  buildDeliveryProfileCreateInput,
  buildDeliveryProfileUpdateInput,
  profileTagFor,
  DELIVERY_PROFILE_CREATE_MUTATION,
  DELIVERY_PROFILE_UPDATE_MUTATION,
  DELIVERY_PROFILE_REMOVE_MUTATION,
} from './market-shipping';
import type { MarketShipping } from '../types';

describe('profileTagFor', () => {
  it('formats tag as "<market name> – <storeId 8 chars>"', () => {
    expect(profileTagFor('Europe', 'abcd1234-5678-90ab-cdef-1234567890ab'))
      .toBe('Europe – abcd1234');
  });
});

describe('buildDeliveryProfileCreateInput', () => {
  const shipping: MarketShipping = {
    zones: {
      'EU Standard': {
        countries: ['DE', 'FR'],
        rates: { 'Standard': { type: 'flat', price: 8, currency: 'EUR' } },
      },
    },
  };

  it('builds create input with profile name + zones + method definitions', () => {
    const input = buildDeliveryProfileCreateInput({
      marketName: 'Europe',
      storeId: 'abcd1234-5678',
      marketId: 'gid://shopify/Market/2',
      shipping,
    });
    expect(input.name).toBe('Europe – abcd1234');
    expect(input.profileLocationGroups).toHaveLength(1);
    const lg = input.profileLocationGroups[0];
    expect(lg.locationGroupZones).toHaveLength(1);
    expect(lg.locationGroupZones[0].name).toBe('EU Standard');
    expect(lg.locationGroupZones[0].countries).toEqual([
      { code: 'DE' }, { code: 'FR' },
    ]);
    expect(lg.locationGroupZones[0].methodDefinitionsToCreate).toEqual([
      { name: 'Standard', price: { amount: 8, currencyCode: 'EUR' } },
    ]);
  });
});

describe('buildDeliveryProfileUpdateInput', () => {
  it('produces zonesToCreate when zone is new', () => {
    const input = buildDeliveryProfileUpdateInput({
      currentZones: {},
      effectiveZones: {
        'New Zone': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat', price: 5, currency: 'EUR' } },
        },
      },
      shopifyIds: { zoneIdByName: {}, rateIdByZoneAndName: {} },
    });
    expect(input.zonesToCreate).toHaveLength(1);
    expect(input.zonesToDelete).toEqual([]);
    expect(input.methodDefinitionsToUpdate).toEqual([]);
  });

  it('produces methodDefinitionsToUpdate when rate price changes', () => {
    const input = buildDeliveryProfileUpdateInput({
      currentZones: {
        'Zone A': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat', price: 5, currency: 'EUR' } },
        },
      },
      effectiveZones: {
        'Zone A': {
          countries: ['DE'],
          rates: { 'Std': { type: 'flat', price: 8, currency: 'EUR' } },
        },
      },
      shopifyIds: {
        zoneIdByName: { 'Zone A': 'gid://Zone/1' },
        rateIdByZoneAndName: { 'Zone A.Std': 'gid://Method/1' },
      },
    });
    expect(input.methodDefinitionsToUpdate).toEqual([
      { id: 'gid://Method/1', price: 8, currency: 'EUR' },
    ]);
    expect(input.zonesToCreate).toEqual([]);
    expect(input.zonesToDelete).toEqual([]);
  });

  it('produces zonesToDelete when zone removed', () => {
    const input = buildDeliveryProfileUpdateInput({
      currentZones: {
        'Old Zone': { countries: ['DE'], rates: {} },
      },
      effectiveZones: {},
      shopifyIds: {
        zoneIdByName: { 'Old Zone': 'gid://Zone/9' },
        rateIdByZoneAndName: {},
      },
    });
    expect(input.zonesToDelete).toEqual(['gid://Zone/9']);
  });
});

describe('mutation strings', () => {
  it('all are valid GraphQL mutations', () => {
    expect(DELIVERY_PROFILE_CREATE_MUTATION).toContain('deliveryProfileCreate');
    expect(DELIVERY_PROFILE_UPDATE_MUTATION).toContain('deliveryProfileUpdate');
    expect(DELIVERY_PROFILE_REMOVE_MUTATION).toContain('deliveryProfileRemove');
  });
});
