import type { MarketShipping, ShippingZone } from '../types';

export function profileTagFor(marketName: string, storeId: string): string {
  return `${marketName} – ${storeId.slice(0, 8)}`;
}

export interface ProfileCreateInput {
  name: string;
  profileLocationGroups: Array<{
    countries: Array<{ code: string }>;
    locationGroupZones: Array<{
      name: string;
      countries: Array<{ code: string }>;
      methodDefinitionsToCreate: Array<{
        name: string;
        price: { amount: number; currencyCode: string };
      }>;
    }>;
  }>;
  marketsToAssociate?: string[];
}

export function buildDeliveryProfileCreateInput(args: {
  marketName: string;
  storeId: string;
  marketId: string;
  shipping: MarketShipping;
}): ProfileCreateInput {
  const name = profileTagFor(args.marketName, args.storeId);
  const allCountries = new Set<string>();
  const zones = Object.entries(args.shipping.zones).map(([zoneName, zone]) => {
    zone.countries.forEach((c) => allCountries.add(c));
    return {
      name: zoneName,
      countries: zone.countries.map((c) => ({ code: c })),
      methodDefinitionsToCreate: Object.entries(zone.rates).map(([rateName, rate]) => ({
        name: rateName,
        price: { amount: rate.price, currencyCode: rate.currency },
      })),
    };
  });

  return {
    name,
    profileLocationGroups: [{
      countries: Array.from(allCountries).map((c) => ({ code: c })),
      locationGroupZones: zones,
    }],
    marketsToAssociate: [args.marketId],
  };
}

export interface ProfileUpdateInput {
  zonesToCreate: Array<{
    name: string;
    countries: Array<{ code: string }>;
    methodDefinitionsToCreate: Array<{
      name: string;
      price: { amount: number; currencyCode: string };
    }>;
  }>;
  zonesToDelete: string[];
  methodDefinitionsToCreate: Array<{
    zoneId: string;
    name: string;
    price: number;
    currency: string;
  }>;
  methodDefinitionsToUpdate: Array<{ id: string; price: number; currency: string }>;
  methodDefinitionsToDelete: string[];
}

export function buildDeliveryProfileUpdateInput(args: {
  currentZones: Record<string, ShippingZone>;
  effectiveZones: Record<string, ShippingZone>;
  shopifyIds: {
    zoneIdByName: Record<string, string>;
    rateIdByZoneAndName: Record<string, string>;
  };
}): ProfileUpdateInput {
  const out: ProfileUpdateInput = {
    zonesToCreate: [],
    zonesToDelete: [],
    methodDefinitionsToCreate: [],
    methodDefinitionsToUpdate: [],
    methodDefinitionsToDelete: [],
  };

  for (const [name, zone] of Object.entries(args.effectiveZones)) {
    const existing = args.currentZones[name];
    if (!existing) {
      out.zonesToCreate.push({
        name,
        countries: zone.countries.map((c) => ({ code: c })),
        methodDefinitionsToCreate: Object.entries(zone.rates).map(([rn, r]) => ({
          name: rn,
          price: { amount: r.price, currencyCode: r.currency },
        })),
      });
      continue;
    }
    const zoneId = args.shopifyIds.zoneIdByName[name];
    for (const [rateName, r] of Object.entries(zone.rates)) {
      const existingRate = existing.rates[rateName];
      const existingRateId = args.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`];
      if (!existingRate) {
        out.methodDefinitionsToCreate.push({
          zoneId, name: rateName, price: r.price, currency: r.currency,
        });
      } else if (existingRate.price !== r.price || existingRate.currency !== r.currency) {
        out.methodDefinitionsToUpdate.push({
          id: existingRateId, price: r.price, currency: r.currency,
        });
      }
    }
    for (const rateName of Object.keys(existing.rates)) {
      if (!zone.rates[rateName]) {
        out.methodDefinitionsToDelete.push(
          args.shopifyIds.rateIdByZoneAndName[`${name}.${rateName}`],
        );
      }
    }
  }
  for (const name of Object.keys(args.currentZones)) {
    if (!args.effectiveZones[name]) {
      out.zonesToDelete.push(args.shopifyIds.zoneIdByName[name]);
    }
  }
  return out;
}

export const DELIVERY_PROFILE_CREATE_MUTATION = `
  mutation DeliveryProfileCreate($profile: DeliveryProfileInput!) {
    deliveryProfileCreate(profile: $profile) {
      profile { id name }
      userErrors { field message }
    }
  }
`;

export const DELIVERY_PROFILE_UPDATE_MUTATION = `
  mutation DeliveryProfileUpdate($id: ID!, $profile: DeliveryProfileInput!) {
    deliveryProfileUpdate(id: $id, profile: $profile) {
      profile { id }
      userErrors { field message }
    }
  }
`;

export const DELIVERY_PROFILE_REMOVE_MUTATION = `
  mutation DeliveryProfileRemove($id: ID!) {
    deliveryProfileRemove(id: $id) {
      job { id }
      userErrors { field message }
    }
  }
`;
