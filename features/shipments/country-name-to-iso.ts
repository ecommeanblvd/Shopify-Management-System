/**
 * Map the operator's free-text country column from the LOG-Export
 * Excel (col M) to ISO-2 codes the carrier engine expects.
 *
 * The Excel field is messy: full English names ("Saudi Arabia"),
 * ISO-2 already ("SA"), and de-duplication failures from formula
 * concat ("Saudi Arabia,Saudi Arabia"). The lookup peels these
 * three cases in order:
 *   1. Already ISO-2? → return as-is
 *   2. Comma-joined repeats? → take first segment
 *   3. Known English name? → table lookup
 *
 * Returns NULL when none match — the importer logs these to a
 * "needs_country_iso_review" bucket so the operator can extend the
 * map. The table covers every name actually seen in the 2026-06-03
 * Excel snapshot (77 distinct strings collapsed to ~50 countries).
 */

const NAME_TO_ISO: Record<string, string> = {
  // Top of the distribution — what 95 % of orders ship to.
  'saudi arabia': 'SA',
  'united states': 'US',
  'qatar': 'QA',
  'china': 'CN',
  'kuwait': 'KW',
  'united arab emirates': 'AE',
  'united kingdom': 'GB',
  'australia': 'AU',
  'canada': 'CA',
  'japan': 'JP',
  'philippines': 'PH',
  'singapore': 'SG',
  'israel': 'IL',
  'vietnam': 'VN',
  'viet nam': 'VN',
  'france': 'FR',
  'hong kong': 'HK',
  'germany': 'DE',
  'thailand': 'TH',
  'malaysia': 'MY',
  'bahrain': 'BH',
  'mexico': 'MX',
  'taiwan': 'TW',
  'spain': 'ES',
  'italy': 'IT',
  'switzerland': 'CH',
  'romania': 'RO',
  'luxembourg': 'LU',
  'oman': 'OM',
  'cyprus': 'CY',
  'portugal': 'PT',
  'belgium': 'BE',
  'czech republic': 'CZ',
  'czechia': 'CZ',
  'indonesia': 'ID',
  'malta': 'MT',
  'nigeria': 'NG',
  'austria': 'AT',
  'norway': 'NO',
  'netherlands': 'NL',
  'iraq': 'IQ',
  'jordan': 'JO',
  'monaco': 'MC',
  'brazil': 'BR',
  'ireland': 'IE',
  'peru': 'PE',
  'egypt': 'EG',
  'trinidad and tobago': 'TT',
  'south korea': 'KR',
  'korea': 'KR',
  'republic of korea': 'KR',
  'kazakhstan': 'KZ',
  'slovakia': 'SK',
  'denmark': 'DK',
  'jersey': 'JE',
  'poland': 'PL',
  'macao': 'MO',
  'macau': 'MO',
  'cambodia': 'KH',
  'bulgaria': 'BG',
  'south africa': 'ZA',
  "lao people's democratic republic": 'LA',
  'laos': 'LA',
  'angola': 'AO',
  'georgia': 'GE',
  'lithuania': 'LT',
  // Less-common but plausible — preload so the importer doesn't choke.
  'finland': 'FI',
  'sweden': 'SE',
  'greece': 'GR',
  'hungary': 'HU',
  'iceland': 'IS',
  'india': 'IN',
  'new zealand': 'NZ',
  'south sudan': 'SS',
  'sudan': 'SD',
  'turkey': 'TR',
  'türkiye': 'TR',
  'argentina': 'AR',
  'chile': 'CL',
  'colombia': 'CO',
  'russia': 'RU',
  'russian federation': 'RU',
  'ukraine': 'UA',
  'pakistan': 'PK',
  'bangladesh': 'BD',
  'sri lanka': 'LK',
  'lebanon': 'LB',
};

const ISO2_RE = /^[A-Z]{2}$/;

/**
 * Returns ISO-2 country code for the operator's free-text input, or
 * NULL if no match. Case-insensitive. Handles ISO-2 pass-through and
 * the "Saudi Arabia,Saudi Arabia" formula-bug case.
 */
export function countryNameToIso(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Case 1: ISO-2 already (caller may pre-uppercase or not).
  const upper = trimmed.toUpperCase();
  if (ISO2_RE.test(upper)) return upper;

  // Case 2: "X,X,X" from a busted Excel formula — collapse to first segment.
  const firstSegment = trimmed.split(',')[0].trim();
  const lookupKey = firstSegment.toLowerCase();

  // Case 3: full English name → ISO-2 via table.
  return NAME_TO_ISO[lookupKey] ?? null;
}

/** ISO-2 → tên nước (đảo NAME_TO_ISO; tên đầu tiên gặp thắng). */
const ISO_TO_NAME: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [name, iso] of Object.entries(NAME_TO_ISO)) {
    if (!m[iso]) m[iso] = name.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return m;
})();

/** Tên nước đầy đủ cho mã ISO-2; trả lại chính mã nếu chưa có trong bảng. */
export function isoToCountryName(iso: string | null | undefined): string {
  if (!iso) return '—';
  return ISO_TO_NAME[iso.toUpperCase()] ?? iso.toUpperCase();
}
