/**
 * FedEx Demand-Surcharge region → ISO-2 country-code mapping.
 *
 * FedEx groups destinations into named regions (Europe², MEISA³, LAC⁴, …) on
 * the demand-surcharge PDF. The parser yields a region *key*; this map expands
 * that key into the concrete ISO-2 country codes the surcharge applies to, so
 * the surcharge can be stored per-country in the rate engine.
 *
 * Single-country regions (Israel→IL, Canada→CA, India→IN) are listed too so
 * callers have one uniform lookup.
 */
export const REGION_COUNTRIES: Record<string, string[]> = {
  israel: ['IL'],
  europe: [
    'AL', 'AD', 'AM', 'AT', 'AZ', 'BY', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ',
    'DK', 'EE', 'FI', 'FR', 'GE', 'DE', 'GI', 'GR', 'GL', 'HU', 'IS', 'IE',
    'IT', 'LV', 'LI', 'LT', 'LU', 'MK', 'MT', 'MD', 'MC', 'ME', 'NL', 'NO',
    'PL', 'PT', 'RO', 'RU', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE', 'CH', 'TR',
    'UA', 'GB', 'VA', 'FO',
  ],
  meisa: [
    'AF', 'BH', 'BD', 'BT', 'EG', 'JO', 'KW', 'KG', 'MV', 'NP', 'OM', 'PS',
    'SA', 'LK', 'AE', 'UZ', 'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CM', 'CV',
    'TD', 'CG', 'CD', 'DJ', 'ER', 'ET', 'GA', 'GM', 'GH', 'GN', 'IQ', 'CI',
    'KZ', 'KE', 'LB', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA',
    'MZ', 'NA', 'NE', 'NG', 'PK', 'QA', 'RE', 'RW', 'SN', 'SC', 'ZA', 'SZ',
    'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW',
  ],
  lac: [
    'AI', 'AG', 'AR', 'AW', 'BS', 'BB', 'BZ', 'BM', 'BO', 'BQ', 'BR', 'VG',
    'KY', 'CL', 'CO', 'CR', 'CW', 'DM', 'DO', 'EC', 'SV', 'GF', 'GD', 'GP',
    'GT', 'GY', 'HT', 'HN', 'JM', 'MQ', 'MS', 'NI', 'PA', 'PY', 'PE', 'KN',
    'LC', 'MF', 'VC', 'SX', 'SR', 'TT', 'TC', 'VI', 'UY', 'VE',
  ],
  canada: ['CA'],
  mexico: ['MX'],
  usa: ['US', 'PR'],
  australia_nz: ['AU', 'NZ'],
  india: ['IN'],
  asia: [
    'AS', 'BN', 'KH', 'CN', 'CK', 'TL', 'FJ', 'PF', 'GU', 'HK', 'ID', 'JP',
    'LA', 'MO', 'MY', 'MH', 'FM', 'MN', 'NC', 'MP', 'PW', 'PG', 'PH', 'WS',
    'SG', 'KR', 'TW', 'TH', 'TO', 'VU', 'WF',
  ],
};

/** Expand a region key into ISO-2 codes. Unknown key → empty array. */
export function regionToCountries(regionKey: string): string[] {
  return REGION_COUNTRIES[regionKey] ?? [];
}
