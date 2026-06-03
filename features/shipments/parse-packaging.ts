/**
 * Parse the operator's Excel "Select VTĐG1" column (cột AA) into a
 * canonical packaging_type for the carrier-engine quote.
 *
 * The Excel value is a free-text inventory code, e.g.
 *   "MEAN-BOX-42x30x10-CAR-02-VTĐG1-WH-25611"  → 'box'
 *   "MEAN-PAK-VTĐG1-WH-25611"                   → 'bag' (PAK rate)
 *   "MEAN-BAG-soft-pouch-2025"                  → 'bag'
 * Falls through to `null` for any string that doesn't mention BOX, PAK
 * or BAG — the engine then uses its legacy weight rule.
 *
 * Pure helper — no DB / I/O. Operator spec: `BOX` → Package rate,
 * `PAK`/`BAG` → PAK rate.
 */

export type PackagingType = 'bag' | 'box';

/** Returns the packaging type for the engine, or NULL when the inventory
 *  code is ambiguous. Case-insensitive. */
export function parsePackagingType(
  inventoryCode: string | null | undefined,
): PackagingType | null {
  if (!inventoryCode) return null;
  // Normalise: strip separators that could break word matching ("-"
  // and "_" are common in operator codes). Upper-case once.
  const haystack = inventoryCode.toUpperCase().replace(/[-_]/g, ' ');
  // BOX wins when both BOX and BAG appear because rigid boxes ALWAYS
  // bill as Package — Pak rates only apply to soft envelopes.
  if (/\bBOX\b/.test(haystack)) return 'box';
  if (/\bPAK\b/.test(haystack)) return 'bag';
  if (/\bBAG\b/.test(haystack)) return 'bag';
  return null;
}
