import { describe, it, expect } from 'vitest';
import { normalizeShopifyDeliveryProfile, denormalizeToMutationInput, normalizeAllDeliveryProfiles, buildProfileUpdateVariables } from './shipping';

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
                      zone: { id: 'gid://shopify/DeliveryZone/10', name: 'Domestic', countries: [{ code: { countryCode: 'VN', restOfWorld: false } }] },
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

describe('buildProfileUpdateVariables — đúng schema DeliveryProfileInput', () => {
  it('zone mới → locationGroupsToUpdate.zonesToCreate (countries + rateDefinition); xoá zone → top-level zonesToDelete', () => {
    const current = {
      tree: { zones: { OldAmerica: { countries: ['US'], rates: {} } } },
      shopifyIds: { profileId: 'gid://P/1', locationGroupId: 'gid://LG/9', zoneIdByName: { OldAmerica: 'gid://Z/20' }, rateIdByZoneAndName: {} },
    };
    const effective = { zones: { 'America — FedEx D': { countries: ['US', 'CA'], rates: { 'Standard': { type: 'flat' as const, price: 50, currency: 'USD' } } } } };
    const out = buildProfileUpdateVariables(current as never, effective, 'gid://LG/9');
    expect(out.id).toBe('gid://P/1');
    const profile = out.profile as { locationGroupsToUpdate: Array<{ id: string; zonesToCreate?: unknown[] }>; zonesToDelete?: string[] };
    expect(profile.locationGroupsToUpdate[0].id).toBe('gid://LG/9');
    const zc = profile.locationGroupsToUpdate[0].zonesToCreate as Array<{ name: string; countries: Array<{ code: string }>; methodDefinitionsToCreate: Array<{ name: string; rateDefinition: { price: { amount: string; currencyCode: string } } }> }>;
    expect(zc[0].name).toBe('America — FedEx D');
    expect(zc[0].countries).toEqual([{ code: 'US', includeAllProvinces: true }, { code: 'CA', includeAllProvinces: true }]);
    expect(zc[0].methodDefinitionsToCreate[0].rateDefinition.price).toEqual({ amount: '50', currencyCode: 'USD' });
    expect(profile.zonesToDelete).toEqual(['gid://Z/20']); // OldAmerica bị phủ trùng US
  });

  it('free zone không trùng nước → KHÔNG xoá', () => {
    const current = {
      tree: { zones: { Domestic: { countries: ['VN'], rates: {} } } },
      shopifyIds: { profileId: 'gid://P/1', locationGroupId: 'gid://LG/9', zoneIdByName: { Domestic: 'gid://Z/10' }, rateIdByZoneAndName: {} },
    };
    const effective = { zones: { 'America — FedEx D': { countries: ['US'], rates: {} } } };
    const out = buildProfileUpdateVariables(current as never, effective, 'gid://LG/9');
    expect((out.profile as { zonesToDelete?: string[] }).zonesToDelete).toBeUndefined();
  });
});

describe('normalizeAllDeliveryProfiles', () => {
  it('trả MỌI profile (không chỉ default) kèm tên + tree riêng', () => {
    const data = {
      deliveryProfiles: { edges: [
        { node: { id: 'gid://shopify/DeliveryProfile/1', name: 'General profile', default: true,
          profileLocationGroups: [{ locationGroupZones: { edges: [
            { node: { zone: { id: 'z10', name: 'Domestic', countries: [{ code: { countryCode: 'VN' } }] }, methodDefinitions: { edges: [] } } },
          ] } }] } },
        { node: { id: 'gid://shopify/DeliveryProfile/2', name: 'Made to order', default: false,
          profileLocationGroups: [{ locationGroupZones: { edges: [
            { node: { zone: { id: 'z20', name: 'America', countries: [{ code: { countryCode: 'US' } }] }, methodDefinitions: { edges: [] } } },
          ] } }] } },
      ] },
    };
    const all = normalizeAllDeliveryProfiles(data);
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.name)).toEqual(['General profile', 'Made to order']);
    expect(all[0].isDefault).toBe(true);
    expect(all[1].normalized.shopifyIds.profileId).toBe('gid://shopify/DeliveryProfile/2');
    expect(Object.keys(all[1].normalized.tree.zones)).toEqual(['America']);
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

  it('xoá zone cũ bị PHỦ TRÙNG nước, GIỮ zone không trùng nước nào (free zone VN/HK)', () => {
    // Current: Domestic(VN) free + OldAmerica(US,CA). Effective thay bằng zone
    // hệ thống phủ US,CA — KHÔNG có VN. → xoá OldAmerica (trùng US/CA), giữ Domestic.
    const current = normalizeShopifyDeliveryProfile({
      deliveryProfiles: { edges: [{ node: {
        id: 'gid://shopify/DeliveryProfile/1', default: true,
        profileLocationGroups: [{ locationGroupZones: { edges: [
          { node: { zone: { id: 'gid://shopify/DeliveryZone/10', name: 'Domestic', countries: [{ code: { countryCode: 'VN' } }] }, methodDefinitions: { edges: [] } } },
          { node: { zone: { id: 'gid://shopify/DeliveryZone/20', name: 'OldAmerica', countries: [{ code: { countryCode: 'US' } }, { code: { countryCode: 'CA' } }] }, methodDefinitions: { edges: [] } } },
        ] } }],
      } }] },
    });
    const effective = {
      zones: { 'America — FedEx D': { countries: ['US', 'CA'], rates: { 'FedEx IP (0–1 kg)': { type: 'flat' as const, price: 50, currency: 'USD' } } } },
    };
    const input = denormalizeToMutationInput(current, effective);
    const deletedIds = input.zonesToDelete;
    expect(deletedIds).toContain('gid://shopify/DeliveryZone/20'); // OldAmerica bị phủ trùng → xoá
    expect(deletedIds).not.toContain('gid://shopify/DeliveryZone/10'); // Domestic(VN) free → GIỮ
  });
});
