/**
 * Map Shopify shipping-line metadata to a carrier_key the quote engine
 * understands. Operator spec:
 *
 *   - explicit FedEx → 'fedex'
 *   - explicit DHL   → 'dhl'
 *   - anything else  → NULL (the quote engine then defaults to 'fedex')
 *
 * Pure helper — no DB, no I/O. Title/code matching is case-insensitive
 * and tolerant of variant spellings ("FedEx Express", "FEDEX_INTERNATIONAL",
 * "DHL eCommerce", "dhl_express_worldwide"). Tests pin the surface.
 */

import type { ShopifyShippingLine } from '../shopify-types';

export type CarrierKey = 'fedex' | 'dhl' | 'aramex';

/** Returns the carrier key the order ships under, or NULL when none of
 *  the shipping lines obviously belong to a known carrier. */
export function detectCarrierKey(
  shippingLines: readonly ShopifyShippingLine[] | null | undefined,
): CarrierKey | null {
  if (!shippingLines || shippingLines.length === 0) return null;
  for (const line of shippingLines) {
    // Normalise underscores → spaces so `\b` matches between
    // 'dhl_express_worldwide' and 'FEDEX_GROUND'. Regex word-boundary
    // treats `_` as a word character, so without this `\bdhl\b` would
    // skip those operator-style titles entirely.
    const haystack = `${line.title ?? ''} ${line.code ?? ''}`
      .toLowerCase()
      .replace(/_/g, ' ');
    if (!haystack.trim()) continue;
    // DHL first because some operator titles include both names
    // ("DHL Express + FedEx backup" hypothetical) — first explicit hit
    // wins, but we'd rather over-attribute the more carefully-modelled
    // carrier when a Premier shipping line names both.
    if (/\bdhl\b/.test(haystack)) return 'dhl';
    if (/\bfedex\b/.test(haystack)) return 'fedex';
    if (/\baramex\b/.test(haystack)) return 'aramex';
  }
  return null;
}
