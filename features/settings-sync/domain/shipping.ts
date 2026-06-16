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
          default
          profileLocationGroups {
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
  default: boolean;
  profileLocationGroups: Array<{
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

export function normalizeShopifyDeliveryProfile(data: unknown): NormalizedShipping {
  const typed = data as ShopifyDeliveryProfilesResponse;
  const edges = typed?.deliveryProfiles?.edges ?? [];
  const defaultProfileNode =
    edges.find((p) => p.node.default)?.node ?? edges[0]?.node;

  if (!defaultProfileNode) {
    return {
      tree: { zones: {} },
      shopifyIds: { profileId: '', zoneIdByName: {}, rateIdByZoneAndName: {} },
    };
  }

  const tree: ShippingTree = { zones: {} };
  const shopifyIds: ShopifyIds = {
    profileId: defaultProfileNode.id,
    zoneIdByName: {},
    rateIdByZoneAndName: {},
  };

  for (const lg of defaultProfileNode.profileLocationGroups ?? []) {
    for (const zoneEdge of lg.locationGroupZones?.edges ?? []) {
      const z = zoneEdge.node;
      const zoneName = z.zone.name;
      shopifyIds.zoneIdByName[zoneName] = z.zone.id;

      const rates: Record<string, ShippingRate> = {};
      for (const re of z.methodDefinitions?.edges ?? []) {
        const m = re.node;
        const rp = m.rateProvider;
        if (rp?.__typename === 'DeliveryRateDefinition' && rp.price) {
          rates[m.name] = {
            type: 'flat',
            price: Number(rp.price.amount),
            currency: rp.price.currencyCode,
          };
          shopifyIds.rateIdByZoneAndName[`${zoneName}.${m.name}`] = m.id;
        }
      }

      tree.zones[zoneName] = {
        countries: (z.zone.countries ?? [])
          .filter((c) => !c.code.restOfWorld)
          .map((c) => c.code.countryCode),
        rates,
      };
    }
  }

  return { tree, shopifyIds };
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
      } else if (existingRate.price !== r.price || existingRate.currency !== r.currency) {
        out.methodDefinitionsToUpdate.push({
          id: existingRateId,
          price: r.price,
          currency: r.currency,
        });
      }
    }

    for (const rateName of Object.keys(existing.rates)) {
      if (!zone.rates[rateName]) {
        out.methodDefinitionsToDelete.push(
          current.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`],
        );
      }
    }
  }

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
