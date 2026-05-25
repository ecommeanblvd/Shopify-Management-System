// Normalizes raw Shopify deliveryProfiles GraphQL responses into a flat shape
// the UI can render without nested null-checks.

export interface NormalizedRate {
  name: string;
  type: 'flat' | 'carrier' | 'participant' | 'other';
  price: { amount: number; currency: string } | null;
}

export interface NormalizedZone {
  name: string;
  countries: string[]; // ISO-2 codes; empty array means rest-of-world
  restOfWorld: boolean;
  rates: NormalizedRate[];
}

export interface NormalizedProfile {
  name: string;
  zones: NormalizedZone[];
}

export interface NormalizedShipping {
  profiles: NormalizedProfile[];
  totals: {
    profiles: number;
    zones: number;
    rates: number;
    countries: number;
  };
}

export interface ShippingError {
  error: string;
  detail?: string;
}

export function isShippingError(value: unknown): value is ShippingError {
  return (
    typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error: unknown }).error === 'string'
  );
}

interface RawRateProvider {
  __typename?: string;
  price?: { amount?: string; currencyCode?: string };
}

interface RawCountryCode {
  countryCode?: string | null;
  restOfWorld?: boolean | null;
}

interface RawZoneNode {
  zone?: { name?: string; countries?: Array<{ code?: RawCountryCode | null }> };
  methodDefinitions?: { edges?: Array<{ node?: { name?: string; rateProvider?: RawRateProvider } }> };
}

interface RawProfileNode {
  name?: string;
  profileLocationGroups?: Array<{
    locationGroupZones?: { edges?: Array<{ node?: RawZoneNode }> };
  }>;
}

interface RawDeliveryProfilesResponse {
  deliveryProfiles?: { edges?: Array<{ node?: RawProfileNode }> };
}

function rateTypeFromTypename(typename: string | undefined): NormalizedRate['type'] {
  switch (typename) {
    case 'DeliveryRateDefinition': return 'flat';
    case 'DeliveryParticipant': return 'participant';
    case 'DeliveryCarrierService': return 'carrier';
    default: return 'other';
  }
}

export function normalizeShipping(raw: unknown): NormalizedShipping {
  const typed = raw as RawDeliveryProfilesResponse;
  const profileEdges = typed?.deliveryProfiles?.edges ?? [];
  const profiles: NormalizedProfile[] = [];
  let zoneTotal = 0;
  let rateTotal = 0;
  let countryTotal = 0;

  for (const pe of profileEdges) {
    const p = pe.node;
    if (!p) continue;
    const zones: NormalizedZone[] = [];
    for (const lg of p.profileLocationGroups ?? []) {
      for (const ze of lg.locationGroupZones?.edges ?? []) {
        const zn = ze.node;
        if (!zn?.zone) continue;
        const countries: string[] = [];
        let restOfWorld = false;
        for (const c of zn.zone.countries ?? []) {
          if (!c?.code) continue;
          if (c.code.restOfWorld) {
            restOfWorld = true;
            continue;
          }
          if (typeof c.code.countryCode === 'string' && c.code.countryCode) {
            countries.push(c.code.countryCode);
          }
        }
        const rates: NormalizedRate[] = [];
        for (const me of zn.methodDefinitions?.edges ?? []) {
          const md = me.node;
          if (!md) continue;
          const rp = md.rateProvider;
          const priceObj = rp?.price;
          const amount = priceObj?.amount ? Number(priceObj.amount) : NaN;
          const currency = priceObj?.currencyCode;
          rates.push({
            name: md.name ?? '(unnamed)',
            type: rateTypeFromTypename(rp?.__typename),
            price: !Number.isNaN(amount) && currency ? { amount, currency } : null,
          });
        }
        zones.push({
          name: zn.zone.name ?? '(unnamed zone)',
          countries,
          restOfWorld,
          rates,
        });
        zoneTotal += 1;
        rateTotal += rates.length;
        countryTotal += countries.length;
      }
    }
    profiles.push({ name: p.name ?? '(unnamed profile)', zones });
  }

  return {
    profiles,
    totals: {
      profiles: profiles.length,
      zones: zoneTotal,
      rates: rateTotal,
      countries: countryTotal,
    },
  };
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function rateTypeLabel(t: NormalizedRate['type']): string {
  return { flat: 'Flat rate', carrier: 'Carrier', participant: 'App provider', other: 'Other' }[t];
}
