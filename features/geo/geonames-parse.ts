/** THUẦN: parse GeoNames postal TSV + normalize (khớp quote engine). Không I/O. */

export const normPostcode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normCity = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface GeoPostcodeRow {
  countryCode: string; postcode: string; postcodeNorm: string;
  city: string; stateCode: string | null; lat: string | null; lng: string | null;
}
export interface GeoStateRow { countryCode: string; code: string; name: string }
export interface GeoCityRow { countryCode: string; stateCode: string | null; name: string; nameNorm: string }

const fixed5 = (s: string): string | null => {
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(5) : null;
};

/** Parse TSV GeoNames (12 cột), chỉ giữ dòng đúng country; dedup theo (postcodeNorm, cityNorm). */
export function parseGeonamesZipTsv(tsv: string, country: string) {
  const rows: GeoPostcodeRow[] = [];
  const stateMap = new Map<string, GeoStateRow>();
  const cityMap = new Map<string, GeoCityRow>();
  const seen = new Set<string>();
  let skipped = 0;

  for (const line of tsv.split('\n')) {
    if (!line.trim()) continue;
    const c = line.split('\t');
    if (c.length < 11) { skipped++; continue; }
    const [cc, postal, place, admin1Name, admin1Code, , , , , lat, lng] = c;
    if (cc !== country) continue;
    if (!postal || !place) { skipped++; continue; }
    const stateCode = admin1Code?.trim() ? admin1Code.trim() : null;
    const key = `${normPostcode(postal)}|${normCity(place)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      countryCode: cc, postcode: postal, postcodeNorm: normPostcode(postal),
      city: place, stateCode, lat: fixed5(lat), lng: fixed5(lng),
    });
    if (stateCode && admin1Name?.trim()) {
      stateMap.set(stateCode, { countryCode: cc, code: stateCode, name: admin1Name.trim() });
    }
    const cityKey = `${stateCode ?? ''}|${normCity(place)}`;
    if (!cityMap.has(cityKey)) {
      cityMap.set(cityKey, { countryCode: cc, stateCode, name: place, nameNorm: normCity(place) });
    }
  }
  return { rows, states: [...stateMap.values()], cities: [...cityMap.values()], skipped };
}
