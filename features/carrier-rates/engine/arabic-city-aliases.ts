/**
 * Arabic-script → Latin remote-list aliases.
 *
 * Gulf customers often type their Shopify shipping city in Arabic
 * ("الرس") while FedEx/DHL publish remote-area lists in Latin
 * ('ALRASS', 'ARRASS'). The engine's city key normaliser strips
 * non-A-Z0-9 characters, which reduces Arabic names to an empty key —
 * so the remote lookup could never match (real case: #MBLVD27749,
 * DHL SA, billed remote 735,000đ engine 0).
 *
 * Keys are the Arabic name with whitespace/diacritics stripped (see
 * normalizeArabic). Values list every Latin spelling the carrier lists
 * use — the lookup tries each. Evidence-driven: entries added when an
 * order shows the gap; extend freely.
 */

const ALIASES: Record<string, string[]> = {
  // SA — Ar Rass (الرس): DHL lists both spellings, FedEx ALRASS.
  'الرس': ['ALRASS', 'ARRASS'],
  // SA — Buraydah (بريدة): FedEx BURAYDAH.
  'بريدة': ['BURAYDAH', 'BURAIDAH'],
  // SA — Layla (ليلى): DHL LAYLA.
  'ليلى': ['LAYLA', 'LAILA'],
  // QA — Al Shahaniya (الشحانية / الشحانيه): FedEx SHAHANIA.
  'الشحانية': ['SHAHANIA', 'ALSHAHANIYA', 'SHAHANIYA'],
  'الشحانيه': ['SHAHANIA', 'ALSHAHANIYA', 'SHAHANIYA'],
};

const ARABIC_RANGE = /[؀-ۿ]/;

/** Strip everything except Arabic letters so spacing/diacritic variants
 *  of the same name share one key. */
function normalizeArabic(s: string): string {
  return s
    .normalize('NFKC')
    // Remove tashkeel (harakat) diacritics.
    .replace(/[ً-ٰٟ]/g, '')
    .replace(/[^؀-ۿ]/g, '');
}

// Pre-normalised lookup table.
const NORMALIZED = new Map<string, string[]>(
  Object.entries(ALIASES).map(([k, v]) => [normalizeArabic(k), v]),
);

export function hasArabicScript(s: string): boolean {
  return ARABIC_RANGE.test(s);
}

/** Latin remote-list key candidates for an Arabic-script city name.
 *  Empty array when the city isn't in the alias table. */
export function arabicCityCandidates(city: string): string[] {
  return NORMALIZED.get(normalizeArabic(city)) ?? [];
}
