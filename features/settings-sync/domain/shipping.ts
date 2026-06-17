export interface ShippingTree {
  zones: Record<string, ShippingZone>;
}
export interface ShippingZone {
  countries: string[];
  rates: Record<string, ShippingRate>;
}
export interface ShippingRate {
  type: 'flat';
  price: number;
  currency: string;
}

export interface ShopifyIds {
  profileId: string;
  /** DeliveryLocationGroup id của profile (cần cho deliveryProfileUpdate). */
  locationGroupId: string;
  zoneIdByName: Record<string, string>;
  rateIdByZoneAndName: Record<string, string>; // key: "<zoneName>.<rateName>"
}

export interface NormalizedShipping {
  tree: ShippingTree;
  shopifyIds: ShopifyIds;
}

/** Fetch query — caller passes this to the read connector. */
export const SHIPPING_QUERY = `
  query Shipping {
    deliveryProfiles(first: 5) {
      edges {
        node {
          id
          name
          default
          profileLocationGroups {
            locationGroup { id }
            locationGroupZones(first: 50) {
              edges {
                node {
                  zone {
                    id
                    name
                    countries {
                      code {
                        countryCode
                        restOfWorld
                      }
                    }
                  }
                  methodDefinitions(first: 50) {
                    edges {
                      node {
                        id
                        name
                        rateProvider {
                          __typename
                          ... on DeliveryRateDefinition {
                            price { amount currencyCode }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// The Shopify GraphQL response is loosely typed at the boundary; `unknown` is
// used for the parameter and the internal shape is accessed via a typed cast
// after an explicit null-check chain.
interface ShopifyProfileNode {
  id: string;
  name?: string;
  default: boolean;
  profileLocationGroups: Array<{
    locationGroup?: { id: string };
    locationGroupZones: {
      edges: Array<{
        node: {
          zone: { id: string; name: string; countries: Array<{ code: { countryCode: string; restOfWorld: boolean } }> };
          methodDefinitions: {
            edges: Array<{
              node: {
                id: string;
                name: string;
                rateProvider: {
                  __typename: string;
                  price?: { amount: string; currencyCode: string };
                };
              };
            }>;
          };
        };
      }>;
    };
  }>;
}

interface ShopifyDeliveryProfilesResponse {
  deliveryProfiles?: {
    edges?: Array<{ node: ShopifyProfileNode }>;
  };
}

/** Chuẩn hoá 1 profile node → tree + shopifyIds. */
function normalizeProfileNode(node: ShopifyProfileNode): NormalizedShipping {
  const tree: ShippingTree = { zones: {} };
  const shopifyIds: ShopifyIds = {
    profileId: node.id,
    locationGroupId: node.profileLocationGroups?.[0]?.locationGroup?.id ?? '',
    zoneIdByName: {},
    rateIdByZoneAndName: {},
  };

  for (const lg of node.profileLocationGroups ?? []) {
    for (const zoneEdge of lg.locationGroupZones?.edges ?? []) {
      const z = zoneEdge.node;
      const zoneName = z.zone.name;
      shopifyIds.zoneIdByName[zoneName] = z.zone.id;

      const rates: Record<string, ShippingRate> = {};
      for (const re of z.methodDefinitions?.edges ?? []) {
        const m = re.node;
        const rp = m.rateProvider;
        if (rp?.__typename === 'DeliveryRateDefinition' && rp.price) {
          rates[m.name] = { type: 'flat', price: Number(rp.price.amount), currency: rp.price.currencyCode };
          shopifyIds.rateIdByZoneAndName[`${zoneName}.${m.name}`] = m.id;
        }
      }

      tree.zones[zoneName] = {
        countries: (z.zone.countries ?? []).filter((c) => !c.code.restOfWorld).map((c) => c.code.countryCode),
        rates,
      };
    }
  }
  return { tree, shopifyIds };
}

export function normalizeShopifyDeliveryProfile(data: unknown): NormalizedShipping {
  const typed = data as ShopifyDeliveryProfilesResponse;
  const edges = typed?.deliveryProfiles?.edges ?? [];
  const defaultProfileNode = edges.find((p) => p.node.default)?.node ?? edges[0]?.node;
  if (!defaultProfileNode) {
    return { tree: { zones: {} }, shopifyIds: { profileId: '', locationGroupId: '', zoneIdByName: {}, rateIdByZoneAndName: {} } };
  }
  return normalizeProfileNode(defaultProfileNode);
}

export interface ProfileSummary {
  profileId: string;
  name: string;
  isDefault: boolean;
  normalized: NormalizedShipping;
}

/** Chuẩn hoá TẤT CẢ delivery profile (không chỉ default) — để đẩy giá lên các
 *  profile được chọn (vd MEAN tách General + Made-to-order). */
export function normalizeAllDeliveryProfiles(data: unknown): ProfileSummary[] {
  const typed = data as ShopifyDeliveryProfilesResponse;
  const edges = typed?.deliveryProfiles?.edges ?? [];
  return edges.map((e) => ({
    profileId: e.node.id,
    name: e.node.name ?? (e.node.default ? 'General profile' : e.node.id),
    isDefault: e.node.default,
    normalized: normalizeProfileNode(e.node),
  }));
}

export interface MutationInput {
  profileId: string;
  zonesToCreate: Array<{
    name: string;
    countries: string[];
    rates: Array<{ name: string; price: number; currency: string }>;
  }>;
  zonesToDelete: string[]; // zone ids
  methodDefinitionsToCreate: Array<{
    zoneId: string;
    name: string;
    price: number;
    currency: string;
  }>;
  methodDefinitionsToUpdate: Array<{ id: string; price: number; currency: string }>;
  methodDefinitionsToDelete: string[]; // method ids
}

export function denormalizeToMutationInput(
  current: NormalizedShipping,
  effective: ShippingTree,
  replaceRateNames?: Set<string>,
): MutationInput {
  const out: MutationInput = {
    profileId: current.shopifyIds.profileId,
    zonesToCreate: [],
    zonesToDelete: [],
    methodDefinitionsToCreate: [],
    methodDefinitionsToUpdate: [],
    methodDefinitionsToDelete: [],
  };

  const currentZones = current.tree.zones;
  const effectiveZones = effective.zones ?? {};

  for (const [name, zone] of Object.entries(effectiveZones)) {
    const existing = currentZones[name];
    if (!existing) {
      out.zonesToCreate.push({
        name,
        countries: zone.countries,
        rates: Object.entries(zone.rates).map(([rateName, r]) => ({
          name: rateName,
          price: r.price,
          currency: r.currency,
        })),
      });
      continue;
    }

    const existingZoneId = current.shopifyIds.zoneIdByName[name];
    for (const [rateName, r] of Object.entries(zone.rates)) {
      const existingRate = existing.rates[rateName];
      const existingRateId = current.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`];
      if (!existingRate) {
        out.methodDefinitionsToCreate.push({
          zoneId: existingZoneId,
          name: rateName,
          price: r.price,
          currency: r.currency,
        });
      } else if (replaceRateNames?.has(rateName)) {
        // REPLACE-by-name: xoá rate cũ + tạo lại mới (để điều kiện cân mới áp
        // dụng). Chỉ áp cho rate có tên ∈ replaceRateNames (carrier được chọn).
        out.methodDefinitionsToDelete.push(existingRateId);
        out.methodDefinitionsToCreate.push({
          zoneId: existingZoneId,
          name: rateName,
          price: r.price,
          currency: r.currency,
        });
      } else if (existingRate.price !== r.price || existingRate.currency !== r.currency) {
        out.methodDefinitionsToUpdate.push({
          id: existingRateId,
          price: r.price,
          currency: r.currency,
        });
      }
    }

    // Replace-mode: KHÔNG xoá rate vắng mặt (bảo vệ rate carrier khác); chỉ phát
    // sinh recreate-delete ở trên. Bỏ hẳn loop xoá rate vắng mặt.
    if (replaceRateNames) continue;
    for (const rateName of Object.keys(existing.rates)) {
      if (!zone.rates[rateName]) {
        out.methodDefinitionsToDelete.push(
          current.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`],
        );
      }
    }
  }

  // Replace-mode: KHÔNG xoá zone nào (chỉ recreate-delete các rate được chọn) —
  // bảo vệ carrier kia. Bỏ hẳn loop xoá zone.
  if (replaceRateNames) return out;

  // Tập nước mà "effective" phủ. Một zone Shopify cũ chỉ bị XOÁ khi nó bị PHỦ
  // TRÙNG (có ≥1 nước nằm trong effective) — tức đang được zone mới thay thế.
  // Zone không trùng nước nào (free zone nội địa VN/HK, hoặc zone thủ công hệ
  // thống không quản) được GIỮ NGUYÊN — tránh xoá nhầm cấu hình ngoài phạm vi.
  const effectiveCountries = new Set<string>();
  for (const z of Object.values(effectiveZones)) for (const c of z.countries) effectiveCountries.add(c);

  for (const [name, zone] of Object.entries(currentZones)) {
    if (effectiveZones[name]) continue; // còn trong effective → giữ (đã xử lý rate ở trên)
    const supersededByCountry = zone.countries.some((c) => effectiveCountries.has(c));
    if (supersededByCountry) {
      out.zonesToDelete.push(current.shopifyIds.zoneIdByName[name]);
    }
  }

  return out;
}

/** Mutation string — caller passes to writer. Schema verified by implementer. */
export const SHIPPING_MUTATION = `
  mutation DeliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id }
      userErrors { field message }
    }
  }
`;

/**
 * Dựng biến cho `deliveryProfileUpdate` ĐÚNG schema Shopify: zones nằm trong
 * `locationGroupsToUpdate[].zonesToCreate/zonesToUpdate`; xoá zone + xoá rate ở
 * TOP-LEVEL (`zonesToDelete`, `methodDefinitionsToDelete`); giá qua
 * `rateDefinition.price`. Giữ rule free-zone: chỉ xoá zone cũ bị PHỦ TRÙNG nước.
 */
/** Bóc bậc cân (kg) từ tên rate "DHL Express (0.5–1 kg)" → {lower, upper}. */
export function parseWeightBand(rateName: string): { lower: number; upper: number } | null {
  const m = rateName.match(/\(\s*([\d.]+)\s*[–\-]\s*([\d.]+)\s*kg\s*\)/i);
  if (!m) return null;
  const lower = Number(m[1]);
  const upper = Number(m[2]);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) return null;
  return { lower, upper };
}

/** Lệch cận dưới (kg) để hai bậc liền kề KHÔNG chồng tại biên. Shopify chỉ có
 *  ≥/≤ (không có ">" thuần), nên cận dưới của bậc sau = +offset so với cận trên
 *  bậc trước → bậc trên bao gồm biên, bậc sau loại biên. Tên rate GIỮ NGUYÊN
 *  (vd "1.5-2 kg"); chỉ ĐIỀU KIỆN đẩy lên Shopify lệch (≥1.51). */
const BAND_LOWER_OFFSET_KG = 0.01;

/** Điều kiện cân cho Shopify: rate chỉ hiện khi cân giỏ ∈ (lower, upper]. Bậc đầu
 *  (lower=0) bỏ điều kiện cận dưới (luôn đúng). Cận dưới +offset để không chồng
 *  với bậc trước tại biên (vd cân 2.0kg chỉ khớp "1.5-2", không khớp "2-2.5"). */
function weightConditionsFromName(rateName: string): unknown[] {
  const b = parseWeightBand(rateName);
  if (!b) return [];
  const conds: unknown[] = [];
  if (b.lower > 0) conds.push({ criteria: { value: b.lower + BAND_LOWER_OFFSET_KG, unit: 'KILOGRAMS' }, operator: 'GREATER_THAN_OR_EQUAL_TO' });
  conds.push({ criteria: { value: b.upper, unit: 'KILOGRAMS' }, operator: 'LESS_THAN_OR_EQUAL_TO' });
  return conds;
}

const RATE_NAME_MAP: Array<{ prefix: string; name: string }> = [
  { prefix: 'FedEx IP', name: 'Standard shipping' },
  { prefix: 'DHL Express', name: 'Express shipping' },
];

/** Đổi tên rate nguồn (FedEx IP / DHL Express theo bậc cân) → tên gộp + điều kiện
 *  cân (cân vào điều kiện, không vào tên). Prefix lạ → giữ nguyên tên. */
export function normalizeRateForShopify(rateName: string): { name: string; conditions: unknown[] } {
  const mapped = RATE_NAME_MAP.find((m) => rateName.startsWith(m.prefix));
  return { name: mapped ? mapped.name : rateName, conditions: weightConditionsFromName(rateName) };
}

export function buildProfileUpdateVariables(
  current: NormalizedShipping,
  effective: ShippingTree,
  locationGroupId: string,
  replaceRateNames?: Set<string>,
): { id: string; profile: Record<string, unknown> } {
  const currentZones = current.tree.zones;
  const effectiveZones = effective.zones ?? {};
  const effCountries = new Set<string>();
  for (const z of Object.values(effectiveZones)) for (const c of z.countries) effCountries.add(c);

  const md = (name: string, r: ShippingRate) => {
    const wc = weightConditionsFromName(name);
    return {
      name,
      rateDefinition: { price: { amount: String(r.price), currencyCode: r.currency } },
      ...(wc.length ? { weightConditionsToCreate: wc } : {}),
    };
  };

  // Replace-mode: id rate được chọn (∈ replaceRateNames) đã tồn tại → xoá rồi
  // tạo lại mới (md() gắn weightConditionsToCreate). Gom ở đây để đẩy lên
  // top-level methodDefinitionsToDelete (xoá trước, tạo sau).
  const recreateDeleteIds: string[] = [];

  const zonesToCreate: unknown[] = [];
  const zonesToUpdate: unknown[] = [];
  for (const [name, zone] of Object.entries(effectiveZones)) {
    const existing = currentZones[name];
    if (!existing) {
      zonesToCreate.push({
        name,
        // includeAllProvinces: nước có bang/tỉnh (US, CA…) Shopify bắt buộc gồm
        // toàn bộ province; bỏ cờ này → lỗi "must have at least one province".
        countries: zone.countries.map((c) => ({ code: c, includeAllProvinces: true })),
        methodDefinitionsToCreate: Object.entries(zone.rates).map(([rn, r]) => md(rn, r)),
      });
      continue;
    }
    const zoneId = current.shopifyIds.zoneIdByName[name];
    const mdCreate: unknown[] = [];
    const mdUpdate: unknown[] = [];
    for (const [rn, r] of Object.entries(zone.rates)) {
      const er = existing.rates[rn];
      const erId = current.shopifyIds.rateIdByZoneAndName[`${name}.${rn}`];
      if (!er) mdCreate.push(md(rn, r));
      else if (replaceRateNames?.has(rn)) { recreateDeleteIds.push(erId); mdCreate.push(md(rn, r)); }
      else if (er.price !== r.price || er.currency !== r.currency) mdUpdate.push({ id: erId, rateDefinition: { price: { amount: String(r.price), currencyCode: r.currency } } });
    }
    if (mdCreate.length || mdUpdate.length) {
      const zu: Record<string, unknown> = { id: zoneId };
      if (mdCreate.length) zu.methodDefinitionsToCreate = mdCreate;
      if (mdUpdate.length) zu.methodDefinitionsToUpdate = mdUpdate;
      zonesToUpdate.push(zu);
    }
  }

  const zonesToDelete: string[] = [];
  const methodDefinitionsToDelete: string[] = [...recreateDeleteIds];
  // Replace-mode: deletes DUY NHẤT là recreate-delete (id rate được chọn). KHÔNG
  // xoá rate vắng mặt, KHÔNG xoá zone — bảo vệ rate carrier kia.
  if (!replaceRateNames) {
    for (const [name, zone] of Object.entries(currentZones)) {
      const eff = effectiveZones[name];
      if (eff) {
        for (const rn of Object.keys(zone.rates)) {
          if (!eff.rates[rn]) methodDefinitionsToDelete.push(current.shopifyIds.rateIdByZoneAndName[`${name}.${rn}`]);
        }
        continue;
      }
      if (zone.countries.some((c) => effCountries.has(c))) zonesToDelete.push(current.shopifyIds.zoneIdByName[name]);
    }
  }

  const lg: Record<string, unknown> = { id: locationGroupId };
  if (zonesToCreate.length) lg.zonesToCreate = zonesToCreate;
  if (zonesToUpdate.length) lg.zonesToUpdate = zonesToUpdate;

  const profile: Record<string, unknown> = { locationGroupsToUpdate: [lg] };
  if (zonesToDelete.length) profile.zonesToDelete = zonesToDelete;
  if (methodDefinitionsToDelete.length) profile.methodDefinitionsToDelete = methodDefinitionsToDelete;

  return { id: current.shopifyIds.profileId, profile };
}
