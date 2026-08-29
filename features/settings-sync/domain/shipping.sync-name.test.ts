import { describe, expect, it } from 'vitest';
import { normalizeShopifyDeliveryProfile, buildProfileUpdateVariables, denormalizeToMutationInput } from './shipping';

/** Cửa hàng đang có zone NA2 với 2 bậc cân, đều tên "Standard shipping". */
const shopifyHienCo = () => normalizeShopifyDeliveryProfile({
  deliveryProfiles: { edges: [{ node: {
    id: 'gid://p/1', name: 'General', default: true,
    profileLocationGroups: [{ locationGroup: { id: 'gid://lg/1' }, locationGroupZones: { edges: [{ node: {
      zone: { id: 'gid://z/NA2', name: 'NA2', countries: [{ code: { countryCode: 'US', restOfWorld: false } }] },
      methodDefinitions: { edges: [
        { node: { id: 'gid://md/A', name: 'Standard shipping',
          rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '54.5', currencyCode: 'USD' } },
          methodConditions: [{ field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.5, unit: 'KILOGRAMS' } }] } },
        { node: { id: 'gid://md/B', name: 'Standard shipping',
          rateProvider: { __typename: 'DeliveryRateDefinition', price: { amount: '66', currencyCode: 'USD' } },
          methodConditions: [
            { field: 'TOTAL_WEIGHT', operator: 'GREATER_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 0.51, unit: 'KILOGRAMS' } },
            { field: 'TOTAL_WEIGHT', operator: 'LESS_THAN_OR_EQUAL_TO', conditionCriteria: { __typename: 'Weight', value: 1, unit: 'KILOGRAMS' } },
          ] } },
      ] },
    } }] } }],
  } }] },
});

/** Bảng giá hệ thống đặt tên theo hãng + bậc cân. */
const heThong = {
  zones: {
    NA2: {
      countries: ['US'],
      rates: {
        'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: 56, currency: 'USD' },
        'FedEx IP (0.5–1 kg)': { type: 'flat' as const, price: 66, currency: 'USD' },
      },
    },
  },
};

const lay = () => buildProfileUpdateVariables(shopifyHienCo(), heThong, 'gid://lg/1');
const zoneUpdate = () => {
  const p = lay().profile as { locationGroupsToUpdate: Array<{ zonesToUpdate?: Array<Record<string, unknown>> }> };
  return p.locationGroupsToUpdate[0].zonesToUpdate?.[0] ?? {};
};

// Cửa hàng gộp mọi bậc cân dưới MỘT tên rate, còn hệ thống đặt tên riêng cho
// từng bậc. Không quy đổi tên thì đồng bộ coi như chưa có rate nào: tạo thêm
// hàng nghìn rate tên mới bên cạnh rate cũ, khách thấy hàng chục lựa chọn ship
// trùng nhau cho cùng một đơn (đo trên MEAN BLVD: xoá 31, tạo 3.917).
describe('đồng bộ giá ship: quy đổi tên rate về khuôn của cửa hàng', () => {
  it('bậc cân đã có thì SỬA GIÁ, không tạo rate mới', () => {
    const zu = zoneUpdate();
    expect(zu.methodDefinitionsToCreate ?? []).toEqual([]);
    expect(zu.methodDefinitionsToUpdate).toEqual([
      { id: 'gid://md/A', rateDefinition: { price: { amount: '56', currencyCode: 'USD' } } },
    ]);
  });

  it('bậc cân giá không đổi thì không đụng tới', () => {
    const ids = ((zoneUpdate().methodDefinitionsToUpdate ?? []) as Array<{ id: string }>).map((x) => x.id);
    expect(ids).not.toContain('gid://md/B');
  });

  it('không xoá rate đang chạy chỉ vì tên khác', () => {
    const p = lay().profile as { methodDefinitionsToDelete?: string[] };
    expect(p.methodDefinitionsToDelete ?? []).toEqual([]);
  });

  it('bậc cân CHƯA có thì tạo mới, mang tên của cửa hàng kèm điều kiện cân', () => {
    const them = {
      zones: { NA2: { countries: ['US'], rates: {
        ...heThong.zones.NA2.rates,
        'FedEx IP (1–1.5 kg)': { type: 'flat' as const, price: 71, currency: 'USD' },
      } } },
    };
    const p = buildProfileUpdateVariables(shopifyHienCo(), them, 'gid://lg/1').profile as
      { locationGroupsToUpdate: Array<{ zonesToUpdate?: Array<{ methodDefinitionsToCreate?: Array<Record<string, unknown>> }> }> };
    const tao = p.locationGroupsToUpdate[0].zonesToUpdate?.[0].methodDefinitionsToCreate ?? [];
    expect(tao).toHaveLength(1);
    expect(tao[0].name).toBe('Standard shipping');
    expect(tao[0].weightConditionsToCreate).toEqual([
      { criteria: { value: 1.01, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' },
      { criteria: { value: 1.5, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' },
    ]);
  });

  it('zone hoàn toàn mới cũng đặt tên theo khuôn cửa hàng', () => {
    const themZone = {
      zones: {
        ...heThong.zones,
        EU9: { countries: ['DE'], rates: { 'DHL Express (0–0.5 kg)': { type: 'flat' as const, price: 40, currency: 'USD' } } },
      },
    };
    const p = buildProfileUpdateVariables(shopifyHienCo(), themZone, 'gid://lg/1').profile as
      { locationGroupsToUpdate: Array<{ zonesToCreate?: Array<{ name: string; methodDefinitionsToCreate: Array<{ name: string }> }> }> };
    const z = (p.locationGroupsToUpdate[0].zonesToCreate ?? []).find((x) => x.name === 'EU9')!;
    expect(z.methodDefinitionsToCreate[0].name).toBe('Express shipping');
  });
});

// denormalizeToMutationInput là hàm dùng cho màn XEM TRƯỚC. Nó phải đếm giống
// hệt hàm ghi thật, nếu không người dùng thấy "tạo 4.205 rate" rồi bấm đẩy và
// nhận kết quả khác hẳn — hoặc sợ không dám bấm.
describe('xem trước phải đếm giống lúc ghi thật', () => {
  it('bậc cân đã có thì tính là SỬA, không tính là tạo mới', () => {
    const d = denormalizeToMutationInput(shopifyHienCo(), heThong);
    expect(d.methodDefinitionsToCreate).toEqual([]);
    expect(d.methodDefinitionsToUpdate).toEqual([
      { id: 'gid://md/A', price: 56, currency: 'USD' },
    ]);
    expect(d.methodDefinitionsToDelete).toEqual([]);
  });

  it('bậc cân chưa có mới tính là tạo', () => {
    const them = {
      zones: { NA2: { countries: ['US'], rates: {
        ...heThong.zones.NA2.rates,
        'FedEx IP (1–1.5 kg)': { type: 'flat' as const, price: 71, currency: 'USD' },
      } } },
    };
    const d = denormalizeToMutationInput(shopifyHienCo(), them);
    expect(d.methodDefinitionsToCreate).toHaveLength(1);
    expect(d.methodDefinitionsToCreate[0].name).toBe('Standard shipping');
  });

  it('bậc cân cửa hàng có mà bảng giá bỏ đi thì mới tính là xoá', () => {
    const bot = { zones: { NA2: { countries: ['US'], rates: {
      'FedEx IP (0–0.5 kg)': { type: 'flat' as const, price: 54.5, currency: 'USD' },
    } } } };
    const d = denormalizeToMutationInput(shopifyHienCo(), bot);
    expect(d.methodDefinitionsToDelete).toEqual(['gid://md/B']);
  });
});
