/**
 * US Census Geocoder (miễn phí, không API key) — nguồn verify địa chỉ US thứ 2.
 * Best-effort: mọi lỗi/timeout → {matched:false}. Chỉ dùng cho địa chỉ US.
 * Docs: geocoding.geo.census.gov/geocoder (onelineaddress, benchmark Public_AR_Current).
 */
const BASE = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';

/** URL geocode 1 dòng. THUẦN. */
export function buildCensusUrl(oneLine: string): string {
  const u = new URL(BASE);
  u.searchParams.set('address', oneLine);
  u.searchParams.set('benchmark', 'Public_AR_Current');
  u.searchParams.set('format', 'json');
  // Replace + with %20 for compatibility with Census API expectations
  return u.toString().replace(/\+/g, '%20');
}

interface CensusResponse {
  result?: { addressMatches?: Array<{ matchedAddress?: string }> };
}

/** Bóc match đầu tiên từ response Census. THUẦN; rỗng/lỗi → matched:false. */
export function parseCensusMatch(raw: unknown): { matched: boolean; matchedAddress: string | null } {
  const m = (raw as CensusResponse)?.result?.addressMatches?.[0];
  if (m?.matchedAddress) return { matched: true, matchedAddress: m.matchedAddress };
  return { matched: false, matchedAddress: null };
}

/** Geocode best-effort, timeout 4s. Lỗi/timeout/không khớp → {matched:false}. */
export async function geocodeOneLine(oneLine: string): Promise<{ matched: boolean; matchedAddress: string | null }> {
  if (!oneLine.trim()) return { matched: false, matchedAddress: null };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(buildCensusUrl(oneLine), { signal: ctrl.signal });
    const raw = await res.json();
    return parseCensusMatch(raw);
  } catch {
    return { matched: false, matchedAddress: null };
  } finally {
    clearTimeout(timer);
  }
}
