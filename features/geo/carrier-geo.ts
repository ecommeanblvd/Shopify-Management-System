import { and, eq, isNotNull } from 'drizzle-orm';
import { db, schema } from '@/db/client';
import { geoStore } from './geo-store';
import { normPostcode } from './geonames-parse';
import { lookupPostcode } from './queries';
import { listAccounts } from '@/features/carrier-rates/actions';
import { loadAccountSnapshot } from '@/features/carrier-rates/engine/load';
import { matchRemoteTier } from '@/features/carrier-rates/engine/remote-match';

/** Pattern là postcode-thật khi có ít nhất 1 chữ số (loại wildcard '*' + city thuần chữ). */
export function isPostcodePattern(p: string): boolean {
  return /\d/.test(p);
}

/** Postcode trong remote-list carrier (đã normalize) KHÔNG tồn tại trong geo master (nước đã nạp). */
export async function geoRemoteDrift(country: string): Promise<{ checked: number; missing: string[] }> {
  const cc = country.toUpperCase();
  const [imp] = await db.select({ id: schema.geoImports.id }).from(schema.geoImports)
    .where(eq(schema.geoImports.countryCode, cc)).limit(1);
  if (!imp) return { checked: 0, missing: [] }; // nước chưa nạp → không so

  const patterns = await db.selectDistinct({ p: schema.carrierRemotePostcodes.postcodePattern })
    .from(schema.carrierRemotePostcodes)
    .where(and(eq(schema.carrierRemotePostcodes.countryCode, cc), isNotNull(schema.carrierRemotePostcodes.postcodePattern)));
  const masterSet = await geoStore.getPostcodeSet(cc);
  if (!masterSet) return { checked: 0, missing: [] }; // Storage thiếu file dù DB nói imported — coi như chưa nạp

  const missing: string[] = [];
  let checked = 0;
  for (const { p } of patterns) {
    if (!p || !isPostcodePattern(p)) continue; // bỏ wildcard + city-pattern
    checked++;
    if (!masterSet.has(normPostcode(p))) missing.push(p); // NORMALIZE trước khi so (spec §6)
  }
  return { checked, missing };
}

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
    const snap = await loadAccountSnapshot(a.id, new Date(), {
      remoteCountry: cc,
      remotePostcodes: [postcode],
    });
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
