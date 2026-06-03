/**
 * Map the order-number prefix from the operator's ops Excel to the
 * Shopify store handle (slug used in our DB). Spec from 2026-06-03
 * clarification call:
 *
 *   TA     → tinh-atelier        (chưa kết nối — skip)
 *   MBLVD  → meanblvd            (✓ connected)
 *   MIR    → mirermirer-official (✓ connected)
 *   HC     → happy-clothing      (chưa kết nối — skip)
 *   MCN    → mean-china          (chưa kết nối — skip)
 *   MTB    → mean-taobao         (chưa kết nối — skip)
 *   MXHS   → mean-xiaohongshu    (chưa kết nối — skip)
 *   DISCN  → ship hộ đối tác (skip entirely)
 *
 * Pure helper — no DB. The importer joins to `stores` table later.
 *
 * NOTE: the Excel "Store" column (col X) uses a DIFFERENT naming
 * convention ("#TINH" vs order-number prefix "TA"). We key off the
 * ORDER NUMBER prefix because that's what links to `shopifyOrders`.
 */

export interface StorePrefixInfo {
  /** Matches `stores.name` on production — used as the lookup key in
   *  importer's bulk join. */
  handle: 'meanblvd' | 'mirermirer-official' | 'tinhatelier'
    | 'happy-clothing' | 'mean-china' | 'mean-taobao'
    | 'mean-xiaohongshu';
  /** Whether the store is connected to our Shopify sync. Importer
   *  silently skips rows where this is false (returns a counted
   *  'skipped_disconnected' bucket in the summary). */
  connected: boolean;
  /** Display name used in import reports. */
  displayName: string;
}

const PREFIX_MAP: Record<string, StorePrefixInfo> = {
  MBLVD: { handle: 'meanblvd',            connected: true,  displayName: 'meanblvd' },
  MIR:   { handle: 'mirermirer-official', connected: true,  displayName: 'mirermirer official' },
  TA:    { handle: 'tinhatelier',         connected: true,  displayName: 'Tinh Atelier' },
  HC:    { handle: 'happy-clothing',      connected: false, displayName: 'Happy Clothing' },
  MCN:   { handle: 'mean-china',          connected: false, displayName: 'MEAN China' },
  MTB:   { handle: 'mean-taobao',         connected: false, displayName: 'Mean Taobao' },
  MXHS:  { handle: 'mean-xiaohongshu',    connected: false, displayName: 'Mean XiaoHongShu' },
};

export type LookupResult =
  | { kind: 'matched'; prefix: string; info: StorePrefixInfo; orderNumber: string }
  | { kind: 'partner_ship'; orderNumber: string }   // DISCN — skip entirely
  | { kind: 'no_prefix'; raw: string };             // can't parse

/**
 * Parse a raw order number like "#MBLVD28907", "MBLVD28907", "TA2134" or
 * "PK-19379-#MCN26-…" and return the store prefix info.
 *
 * Returns `partner_ship` for DISCN — these are partner ship-only rows
 * the operator wants completely skipped (not even counted as a known
 * disconnected store).
 *
 * Returns `no_prefix` when no known prefix matches — the importer logs
 * these to a separate "needs operator review" bucket.
 */
export function lookupStorePrefix(rawOrderNumber: string | null | undefined): LookupResult {
  if (!rawOrderNumber) return { kind: 'no_prefix', raw: '' };
  const cleaned = rawOrderNumber.trim().replace(/^#/, '').toUpperCase();
  if (cleaned.startsWith('DISCN')) return { kind: 'partner_ship', orderNumber: cleaned };
  // Greedy match: longer prefix first so MBLVD doesn't get parsed as MB.
  const prefixes = Object.keys(PREFIX_MAP).sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (cleaned.startsWith(p)) {
      return { kind: 'matched', prefix: p, info: PREFIX_MAP[p], orderNumber: cleaned };
    }
  }
  return { kind: 'no_prefix', raw: rawOrderNumber };
}
