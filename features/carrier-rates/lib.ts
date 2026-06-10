/**
 * Compute the age in whole days between `now` and a past timestamp.
 *
 * Exposed as a top-level helper (not inlined into a server component) so the
 * react-hooks/purity lint rule does not flag the impure `Date.now()` read.
 * Server components in this app are re-rendered per request, so reading the
 * wall clock here is intentional and safe.
 */
export function daysSince(when: Date | string): number {
  const ts = typeof when === 'string' ? Date.parse(when) : when.getTime();
  // eslint-disable-next-line react-hooks/purity
  const elapsedMs = Date.now() - ts;
  return Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
}

/**
 * Format a date in Vietnamese day-month-year order: `dd-mm-yyyy`.
 *
 * Accepts an ISO `YYYY-MM-DD` string (rate-card effective dates), a Date
 * (surcharge windows stored at midnight UTC — read in UTC to avoid a
 * timezone day-shift), or null/undefined (→ `fallback`, default "open").
 */
export function formatDateVN(value: Date | string | null | undefined, fallback = 'open'): string {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : utcDmy(d);
  }
  return utcDmy(value);
}

/**
 * Format an EXCLUSIVE end bound (carrier_surcharges.ends_at — the engine
 * drops a row when `ends_at <= quoteDate`) as the last day it actually
 * applies, i.e. minus one day. Prevents the "01-06 → 15-06" /
 * "15-06 → nay" display where 15-06 looks owned by both rows.
 */
export function formatExclusiveEndVN(value: Date | string | null | undefined, fallback = 'nay'): string {
  if (value == null) return fallback;
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return typeof value === 'string' ? value : fallback;
  return utcDmy(new Date(d.getTime() - 24 * 60 * 60 * 1000));
}

function utcDmy(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}-${mm}-${d.getUTCFullYear()}`;
}
