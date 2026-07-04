/** THUẦN: chọn kết quả lookup postcode từ danh sách ứng viên. */

export interface GeoCandidate { city: string; stateCode: string | null }
export interface GeoLookupResult {
  valid: boolean; city: string | null; stateCode: string | null; candidates: GeoCandidate[];
}

export function pickLookupResult(cands: GeoCandidate[]): GeoLookupResult {
  if (cands.length === 0) return { valid: false, city: null, stateCode: null, candidates: [] };
  return { valid: true, city: cands[0].city, stateCode: cands[0].stateCode, candidates: cands };
}
