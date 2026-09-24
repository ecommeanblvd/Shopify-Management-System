// Pure function: match a destination postcode / city against a per-country
// remote-area map and return the tier + how we matched it.
// Extracted from quote.ts so it can be tested in isolation.

import { hasArabicScript, arabicCityCandidates } from './arabic-city-aliases';
import { matchRemoteCity } from './remote-city-match';
import { khopDai, type DaiMaBuuChinh } from './remote-range';

/**
 * Resolve the remote-area tier for a single destination.
 *
 * @param perCountry - The per-country Map<key, tier|null> from the snapshot
 *   (`snap.remotePostcodes.get(country)`). `undefined` = country not on any
 *   remote list → both outputs are `null`.
 * @param postcode   - Raw destination postcode (may be null/undefined).
 * @param city       - Raw destination city name (may be null/undefined).
 *
 * @param ranges - Dải mã bưu chính của nước đó (`snap.remotePostcodeRanges?.get(country)`).
 *   Bỏ trống / rỗng = không có dải nào → hành vi y hệt trước khi có dải, nên
 *   DHL và FedEx (1,03 triệu dòng mã chính xác, 0 dòng dải) không đổi gì.
 *
 * Priority order (mirrors the inline block in quote.ts exactly):
 *   1. Postcode: raw → alphanumeric-stripped → ZIP+4 prefix
 *   2. Dải mã bưu chính (`remote-range.ts`)
 *   3. City:     Arabic-alias candidates + Latin-normalised key, via matchRemoteCity
 *   4. Wildcard: `'*'` key in the map
 *   5. No match → `{ tier: null, matchedBy: null }`
 *
 * LUẬT: mã CHÍNH XÁC thắng DẢI. Một dòng ghi đúng mã là hãng nói riêng về mã
 * đó, còn dải là mô tả cả vùng — cái riêng thắng cái chung. Vì vậy bước 2 chỉ
 * chạy khi bước 1 trượt, kể cả khi dòng mã chính xác cho tier RẺ hơn. Luật chọn
 * giữa nhiều dải cùng khớp nằm trong `khopDai` (dải hẹp hơn thắng).
 *
 * Dải xếp TRÊN tên thành phố vì mã bưu chính vẫn cụ thể hơn tên thành phố —
 * giữ đúng thứ tự "mã trước, tên sau" vốn có.
 */
export function matchRemoteTier(
  perCountry: Map<string, string | null> | undefined,
  postcode: string | null | undefined,
  city: string | null | undefined,
  ranges?: readonly DaiMaBuuChinh[],
): { tier: string | null; matchedBy: 'postcode' | 'postcode_range' | 'city' | 'country_default' | null } {
  if (!perCountry) {
    // Vẫn còn cửa cho dải: một nước có thể chỉ được mô tả bằng dải, không có
    // dòng mã chính xác nào, nên `remotePostcodes` không có khoá cho nước đó.
    const chiDai = khopDai(ranges, postcode);
    if (chiDai) return { tier: chiDai.tier, matchedBy: 'postcode_range' };
    return { tier: null, matchedBy: null };
  }

  const patterns = perCountry;
  let matchedTier: string | null | undefined;
  let matchedBy: 'postcode' | 'postcode_range' | 'city' | 'country_default' | null = null;

  if (postcode) {
    // Postcode formats vary between Shopify input and carrier lists:
    // US ZIP+4 '98077-5629' vs stored '98077', JP '818-0084' vs
    // '8180084', PT '5000-289'… Try: raw → alphanumeric-stripped →
    // first segment before a separator (ZIP+4 prefix).
    const raw = postcode.trim();
    const stripped = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const prefix = raw.split(/[-\s]/)[0]?.toUpperCase().replace(/[^A-Z0-9]/g, '') ?? '';
    for (const key of [...new Set([raw, stripped, prefix])]) {
      if (!key) continue;
      const t = patterns.get(key);
      if (t !== undefined) {
        matchedTier = t;
        matchedBy = 'postcode';
        break;
      }
    }
  }

  if (matchedBy === null) {
    // Dải: chỉ chạy khi không có dòng mã chính xác nào khớp (xem LUẬT ở trên).
    const dai = khopDai(ranges, postcode);
    if (dai) {
      matchedTier = dai.tier;
      matchedBy = 'postcode_range';
    }
  }

  if (matchedBy === null && city) {
    // Normalise: uppercase + strip non-alphanumeric. FedEx's source
    // is inconsistent (SA "ABAALWOROOD" vs BH "Durrat Al Bahrain"),
    // and incoming Shopify city values vary even more ("aba al
    // worood", "Aba Alworood"). Stripping all separators normalises
    // both sides. MUST stay in sync with the import script's
    // city-pattern normalisation.
    // Arabic-script cities ("الرس") reduce to an empty key under the
    // A-Z0-9 normaliser — translate via the alias table first and try
    // every Latin spelling the carrier lists use.
    // Luôn kèm bản Latin chuẩn hoá — city Arabic+Latin lẫn lộn ("علي… Ali Sabah
    // Al Salem (Umm Al Hayman)") strip non-alnum còn phần Latin để khớp town list.
    const latinNorm = city.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cityKeys = hasArabicScript(city)
      ? [...arabicCityCandidates(city), latinNorm]
      : [latinNorm];
    // Khớp TOLERANT: exact + alias chính tả + bỏ tiền tố "AL" + prefix (city
    // dính tên vùng). Tránh trượt khi city đơn ghi lệch so với list ODA.
    const cityMatch = matchRemoteCity(cityKeys.filter((k) => k.length > 0), patterns);
    if (cityMatch) {
      matchedTier = cityMatch.tier;
      matchedBy = 'city';
    }
  }

  if (matchedBy === null) {
    // Country-wide wildcard. When a single row for a country is
    // stored with pattern '*', every destination in that country
    // inherits its tier. Used when the carrier's published list is
    // in a postal format we can't reconcile against modern Shopify
    // data — e.g. FedEx IL ships its ODA list in legacy 5-digit
    // codes while Israel Post switched to 7-digit in 2013, leaving
    // no clean per-postcode mapping.
    const wildcard = patterns.get('*');
    if (wildcard !== undefined) {
      matchedTier = wildcard;
      matchedBy = 'country_default';
    }
  }

  if (matchedBy === null) {
    return { tier: null, matchedBy: null };
  }
  return { tier: matchedTier ?? null, matchedBy };
}
