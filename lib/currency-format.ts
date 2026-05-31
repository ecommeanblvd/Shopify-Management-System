/**
 * Currency formatting helpers shared by every money input in the system.
 *
 * `currencyDecimals` decides how many fractional digits a given currency
 * supports. ISO 4217 zero-decimal currencies (VND, JPY, KRW, …) are listed
 * explicitly; everything else defaults to 2.
 *
 * Source: https://en.wikipedia.org/wiki/ISO_4217#Active_codes_(list_one)
 * Keep this list narrow — adding more currencies is cheap, but a wrong
 * entry silently drops cents from operator input.
 */

const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'BIF', // Burundian Franc
  'CLP', // Chilean Peso
  'DJF', // Djiboutian Franc
  'GNF', // Guinean Franc
  'ISK', // Icelandic Króna
  'JPY', // Japanese Yen
  'KMF', // Comorian Franc
  'KRW', // South Korean Won
  'PYG', // Paraguayan Guaraní
  'RWF', // Rwandan Franc
  'UGX', // Ugandan Shilling
  'UYI', // Uruguay Peso en Unidades Indexadas
  'VND', // Vietnamese Đồng
  'VUV', // Vanuatu Vatu
  'XAF', // Central African CFA Franc
  'XOF', // West African CFA Franc
  'XPF', // CFP Franc
]);

/**
 * Returns the natural number of fractional digits to accept for the given
 * ISO-3 currency. Unknown or empty currency → 2.
 */
export function currencyDecimals(currency: string | null | undefined): number {
  if (!currency) return 2;
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}
