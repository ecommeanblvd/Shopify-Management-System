import { describe, it, expect } from 'vitest';
import { normalizeShopifyDeliveryProfile, denormalizeToMutationInput, normalizeAllDeliveryProfiles, buildProfileUpdateVariables, parseWeightBand, normalizeRateForShopify, buildCleanRebuildVariables } from './shipping';
import type { NormalizedShipping, ShippingTree } from './shipping';

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

  it('rate có tên bậc cân → gắn weightConditionsToCreate (gate theo cân)', () => {
    const current = { tree: { zones: {} }, shopifyIds: { profileId: 'gid://P/1', locationGroupId: 'gid://LG/9', zoneIdByName: {}, rateIdByZoneAndName: {} } };
    const effective = { zones: { 'America — FedEx D': { countries: ['US'], rates: {
      'FedEx IP (0–1 kg)': { type: 'flat' as const, price: 50, currency: 'USD' },
      'FedEx IP (1–1.5 kg)': { type: 'flat' as const, price: 60, currency: 'USD' },
    } } } };
    const out = buildProfileUpdateVariables(current as never, effective, 'gid://LG/9');
    type MethodDef = { name: string; weightConditionsToCreate?: unknown };
    const profile = out.profile as { locationGroupsToUpdate: Array<{ zonesToCreate: Array<{ methodDefinitionsToCreate: MethodDef[] }> }> };
    const zc = profile.locationGroupsToUpdate[0].zonesToCreate[0].methodDefinitionsToCreate;
    const r0 = zc.find((m) => m.name === 'FedEx IP (0–1 kg)')!;
    const r1 = zc.find((m) => m.name === 'FedEx IP (1–1.5 kg)')!;
    // bậc 0–1: chỉ có cận trên ≤1 (bỏ ≥0)
    expect(r0.weightConditionsToCreate).toEqual([{ criteria: { value: 1, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' }]);
    // bậc 1–1.5: cận dưới +offset (≥1.01) để không chồng bậc trước tại biên; ≤1.5
    expect(r1.weightConditionsToCreate).toEqual([
      { criteria: { value: 1.01, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' },
      { criteria: { value: 1.5, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
    ]);
  });

  it('parseWeightBand', () => {
    expect(parseWeightBand('DHL Express (0.5–1 kg)')).toEqual({ lower: 0.5, upper: 1 });
    expect(parseWeightBand('FedEx IP (0-1 kg)')).toEqual({ lower: 0, upper: 1 });
    expect(parseWeightBand('Standard rate')).toBeNull();
  });

  it('replace-mode: chỉ xoá+tạo lại rate được chọn theo tên, GIỮ rate carrier kia, KHÔNG xoá zone', () => {
    const current = {
      tree: { zones: { 'America — FedEx D': { countries: ['US'], rates: {
        'Standard shipping': { type: 'flat' as const, price: 50, currency: 'USD' },
        'Express shipping': { type: 'flat' as const, price: 60, currency: 'USD' },
      } } } },
      shopifyIds: {
        profileId: 'gid://P/1', locationGroupId: 'gid://LG/9',
        zoneIdByName: { 'America — FedEx D': 'gid://Z/20' },
        rateIdByZoneAndName: {
          'America — FedEx D.Standard shipping': 'gid://rate/std',
          'America — FedEx D.Express shipping': 'gid://rate/exp',
        },
      },
    };
    const effective = { zones: { 'America — FedEx D': { countries: ['US'], rates: {
      'Standard shipping': { type: 'flat' as const, price: 50, currency: 'USD' },
      'Express shipping': { type: 'flat' as const, price: 60, currency: 'USD' },
    } } } };
    const out = buildProfileUpdateVariables(current as never, effective, 'gid://LG/9', new Set(['Standard shipping']));
    const profile = out.profile as {
      locationGroupsToUpdate: Array<{ zonesToUpdate?: Array<{ methodDefinitionsToCreate?: Array<{ name: string }> }> }>;
      methodDefinitionsToDelete?: string[];
      zonesToDelete?: string[];
    };
    // Xoá đúng id "Standard shipping", KHÔNG xoá "Express shipping".
    expect(profile.methodDefinitionsToDelete).toEqual(['gid://rate/std']);
    expect(profile.methodDefinitionsToDelete).not.toContain('gid://rate/exp');
    // Tạo lại "Standard shipping" trong zonesToUpdate, KHÔNG có "Express shipping".
    const created = profile.locationGroupsToUpdate[0].zonesToUpdate?.[0].methodDefinitionsToCreate ?? [];
    expect(created.map((m) => m.name)).toEqual(['Standard shipping']);
    // KHÔNG xoá zone.
    expect(profile.zonesToDelete).toBeUndefined();
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

describe('normalizeRateForShopify', () => {
  it('FedEx IP → Standard shipping + điều kiện cân (offset 0.01)', () => {
    expect(normalizeRateForShopify('FedEx IP (1.5–2 kg)')).toEqual({
      name: 'Standard shipping',
      conditions: [
        { criteria: { value: 1.51, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' },
        { criteria: { value: 2, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
      ],
    });
  });
  it('DHL Express → Express shipping', () => {
    expect(normalizeRateForShopify('DHL Express (0–0.5 kg)').name).toBe('Express shipping');
  });
  it('bậc đầu lower=0 → chỉ có điều kiện trên', () => {
    expect(normalizeRateForShopify('FedEx IP (0–0.5 kg)').conditions).toEqual([
      { criteria: { value: 0.5, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
    ]);
  });
  it('prefix lạ → giữ nguyên tên', () => {
    expect(normalizeRateForShopify('Standard (2-2.5kg)').name).toBe('Standard (2-2.5kg)');
  });
});

describe('buildCleanRebuildVariables', () => {
  const current: NormalizedShipping = {
    tree: { zones: {
      'Zone G': { countries: ['HK', 'TH'], rates: {} },
      'VN nội địa': { countries: ['VN'], rates: {} },
    } },
    shopifyIds: {
      profileId: 'gid://profile/1', locationGroupId: 'gid://lg/1',
      zoneIdByName: { 'Zone G': 'gid://zone/G', 'VN nội địa': 'gid://zone/VN' },
      rateIdByZoneAndName: {},
    },
  };
  const systemTree: ShippingTree = { zones: {
    GC1: { countries: ['HK'], rates: { 'FedEx IP (1.5–2 kg)': { type: 'flat', price: 30, currency: 'USD' } } },
    SE2: { countries: ['TH'], rates: { 'DHL Express (0–0.5 kg)': { type: 'flat', price: 20, currency: 'USD' } } },
  } };

  const out = buildCleanRebuildVariables(current, systemTree, 'gid://lg/1');

  it('xoá zone giao country (Zone G), GIỮ zone VN', () => {
    expect(out.profile.zonesToDelete).toEqual(['gid://zone/G']);
  });
  it('tạo lại zone hệ thống với tên rate đã gộp + điều kiện cân', () => {
    const lg = (out.profile.locationGroupsToUpdate as Array<{ zonesToCreate: Array<Record<string, unknown>> }>)[0];
    const gc1 = lg.zonesToCreate.find((z) => z.name === 'GC1') as Record<string, unknown> & {
      countries: unknown; methodDefinitionsToCreate: Array<Record<string, unknown>>;
    };
    expect(gc1.countries).toEqual([{ code: 'HK', includeAllProvinces: true }]);
    expect(gc1.methodDefinitionsToCreate[0].name).toBe('Standard shipping');
    expect(gc1.methodDefinitionsToCreate[0].weightConditionsToCreate).toHaveLength(2);
    expect(gc1.methodDefinitionsToCreate[0].rateDefinition).toEqual({ price: { amount: '30', currencyCode: 'USD' } });
  });
  it('id = profileId', () => { expect(out.id).toBe('gid://profile/1'); });
});
