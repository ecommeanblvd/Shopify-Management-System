import { describe, it, expect } from 'vitest';
import { upperBandFromConditions, bandKeyOf, normalizeShopifyDeliveryProfile } from './shipping';

describe('upperBandFromConditions', () => {
  it('returns the LESS_THAN_OR_EQUAL_TO value as the upper band', () => {
    const conds = [
      { field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.51, unit: 'KILOGRAMS' } },
      { field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 1, unit: 'KILOGRAMS' } },
    ];
    expect(upperBandFromConditions(conds as never)).toBe('1');
  });

  it('returns "flat" when there is no upper weight condition', () => {
    expect(upperBandFromConditions([] as never)).toBe('flat');
  });

  it('rounds to 3 decimals', () => {
    const conds = [{ field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.5, unit: 'KILOGRAMS' } }];
    expect(upperBandFromConditions(conds as never)).toBe('0.5');
  });
});

describe('normalizeShopifyDeliveryProfile band map', () => {
  it('keeps two same-named bands distinct (no collision)', () => {
    const data = {
      deliveryProfiles: { edges: [{ node: {
        id: 'gid://p/1', name: 'General', default: true,
        profileLocationGroups: [{ locationGroup: { id: 'gid://lg/1' }, locationGroupZones: { edges: [{ node: {
          zone: { id: 'gid://z/NA2', name: 'NA2', countries: [{ code: { countryCode: 'US', restOfWorld: false } }] },
          methodDefinitions: { edges: [
            { node: { id: 'gid://md/A', name: 'Standard shipping', rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '54.5', currencyCode: 'USD' } },
              methodConditions: [{ field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.5, unit: 'KILOGRAMS' } }] } },
            { node: { id: 'gid://md/B', name: 'Standard shipping', rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '66', currencyCode: 'USD' } },
              methodConditions: [
                { field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.51, unit: 'KILOGRAMS' } },
                { field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 1, unit: 'KILOGRAMS' } },
              ] } },
          ] },
        } }] } }],
      } }] },
    };
    const norm = normalizeShopifyDeliveryProfile(data);
    expect(norm.bandRates[bandKeyOf('NA2', 'Standard shipping', '0.5')]).toEqual({ id: 'gid://md/A', price: 54.5, currency: 'USD' });
    expect(norm.bandRates[bandKeyOf('NA2', 'Standard shipping', '1')]).toEqual({ id: 'gid://md/B', price: 66, currency: 'USD' });
  });
});
