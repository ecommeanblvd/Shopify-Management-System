/**
 * Pure line-classifier for the DHL Express "Remote Area List" PDF, shared by
 * the import script and its tests. Each RAL line under a country header is one
 * of: a town name, a single postcode, or a postcode range.
 *
 * Postcodes keep DHL's hyphen/space forms (JP "001-0000", PT "5000-289") but
 * are returned STRIPPED (uppercase, non-alphanumeric removed) to match the
 * engine's postcode lookup key (see quote.ts: it tries raw, stripped, prefix).
 *
 * A range is "TOKEN - TOKEN" (space-hyphen-space, both sides holding digits) —
 * distinct from the internal hyphen of a single JP/PT code. Ranges expand over
 * the numeric suffix following the endpoints' common prefix.
 */

export const stripPostcode = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export type RalLine =
  | { kind: 'town'; value: string }
  | { kind: 'postcode'; value: string }
  | { kind: 'range'; values: string[] };

export function classifyLine(raw: string): RalLine {
  if (!/[0-9]/.test(raw)) return { kind: 'town', value: stripPostcode(raw) };

  const rangeM = raw.match(/^(.+?)\s+-\s+(.+)$/);
  if (rangeM && /[0-9]/.test(rangeM[1]) && /[0-9]/.test(rangeM[2])) {
    return { kind: 'range', values: expandRange(stripPostcode(rangeM[1]), stripPostcode(rangeM[2])) };
  }
  return { kind: 'postcode', value: stripPostcode(raw) };
}

/** Expand "0010010".."0010040" over the numeric suffix after the common prefix.
 *  Falls back to the two endpoints when their shapes don't line up. */
export function expandRange(a: string, b: string): string[] {
  if (!a || !b) return [a, b].filter(Boolean);
  if (a.length !== b.length) return [a, b];
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  const sa = a.slice(i);
  const sb = b.slice(i);
  if (/^[0-9]+$/.test(sa) && /^[0-9]+$/.test(sb)) {
    const na = Number(sa);
    const nb = Number(sb);
    if (nb >= na && nb - na <= 20000) {
      const out: string[] = [];
      const w = sa.length;
      const head = a.slice(0, i);
      for (let n = na; n <= nb; n++) out.push(head + String(n).padStart(w, '0'));
      return out;
    }
  }
  return [a, b];
}
