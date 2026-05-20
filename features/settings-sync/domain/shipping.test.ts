import { describe, it, expect } from 'vitest';
import { normalizeShopifyDeliveryProfile, denormalizeToMutationInput } from './shipping';

const shopifyResponse = {
  deliveryProfiles: {
    edges: [
      {
        node: {
          id: 'gid://shopify/DeliveryProfile/1',
          default: true,
          profileLocationGroups: [
            {
              locationGroupZones: {
                edges: [
                  {
                    node: {
                      zone: { id: 'gid://shopify/DeliveryZone/10', name: 'Domestic', countries: [{ code: 'VN' }] },
                      methodDefinitions: {
                        edges: [
                          {
                            node: {
                              id: 'gid://shopify/DeliveryMethodDefinition/100',
                              name: 'Standard',
                              rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '30000', currencyCode: 'VND' } },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  },
};

describe('normalizeShopifyDeliveryProfile', () => {
  it('flattens Shopify default delivery profile to the normalized tree shape', () => {
    const result = normalizeShopifyDeliveryProfile(shopifyResponse);
    expect(result.tree).toEqual({
      zones: {
        Domestic: {
          countries: ['VN'],
          rates: {
            Standard: { type: 'flat', price: 30000, currency: 'VND' },
          },
        },
      },
    });
  });

  it('captures shopify ids alongside the tree for downstream mutations', () => {
    const result = normalizeShopifyDeliveryProfile(shopifyResponse);
    expect(result.shopifyIds.profileId).toBe('gid://shopify/DeliveryProfile/1');
    expect(result.shopifyIds.zoneIdByName.Domestic).toBe('gid://shopify/DeliveryZone/10');
    expect(result.shopifyIds.rateIdByZoneAndName['Domestic.Standard']).toBe('gid://shopify/DeliveryMethodDefinition/100');
  });
});

describe('denormalizeToMutationInput', () => {
  it('produces a deliveryProfileUpdate input with create/update/delete buckets', () => {
    const current = normalizeShopifyDeliveryProfile(shopifyResponse);
    const effective = {
      zones: {
        Domestic: { countries: ['VN'], rates: { Standard: { type: 'flat' as const, price: 35000, currency: 'VND' } } },
        International: { countries: ['US'], rates: { Standard: { type: 'flat' as const, price: 200000, currency: 'VND' } } },
      },
    };
    const input = denormalizeToMutationInput(current, effective);
    // The Standard rate price changed.
    expect(input.methodDefinitionsToUpdate).toContainEqual(expect.objectContaining({
      id: 'gid://shopify/DeliveryMethodDefinition/100',
    }));
    // The International zone is new.
    expect(input.zonesToCreate).toContainEqual(expect.objectContaining({
      name: 'International',
    }));
  });
});
