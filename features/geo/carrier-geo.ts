import { lookupPostcode } from './queries';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { matchRemoteTier } from '@/features/carrier-rates/engine/remote-match';

export interface CarrierGeoRow {
  accountId: string;
  accountName: string;
  carrierKey: string | null;
  zone: string | null;
  tier: string | null;
  matchedBy: 'postcode' | 'city' | 'country_default' | null;
}

export interface CarrierGeoLookup {
  geo: { valid: boolean | null; city: string | null; stateCode: string | null };
  carriers: CarrierGeoRow[];
}

export async function lookupCarrierGeo(
  country: string,
  postcode: string,
  city?: string,
): Promise<CarrierGeoLookup> {
  const cc = country.toUpperCase();
  const geoRes = await lookupPostcode(cc, postcode);
  const geo = { valid: geoRes.valid, city: geoRes.city, stateCode: geoRes.stateCode };
  // city to match remote: prefer user-supplied city, fall back to postcode-derived city.
  const cityForMatch = city ?? geoRes.city ?? undefined;

  const accounts = await listAccounts();
  const carriers: CarrierGeoRow[] = [];
  for (const a of accounts) {
    const snap = await loadAccountSnapshot(a.id);
    if (!snap) {
      carriers.push({
        accountId: a.id,
        accountName: a.name,
        carrierKey: a.carrierKey ?? null,
        zone: null,
        tier: null,
        matchedBy: null,
      });
      continue;
    }
    const zone = snap.zonesByCountry.get(cc)?.label ?? null;
    const { tier, matchedBy } = matchRemoteTier(snap.remotePostcodes.get(cc), postcode, cityForMatch);
    carriers.push({
      accountId: a.id,
      accountName: a.name,
      carrierKey: a.carrierKey ?? null,
      zone,
      tier,
      matchedBy,
    });
  }
  return { geo, carriers };
}
