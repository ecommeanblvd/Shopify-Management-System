/**
 * Tiny CSV helpers shared by the per-function admin exports. Kept
 * dependency-free — RFC 4180 quoting plus a streaming-friendly row
 * writer.
 */

export type CsvValue = string | number | boolean | null | undefined | Date;

/** Escapes a single CSV field. Quotes when the value contains a comma,
 *  double quote, newline, carriage return, or leading/trailing
 *  whitespace. Dates serialise to ISO. */
export function csvEscape(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  if (/[",\n\r]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Joins one row of pre-typed values into a CSV line. */
export function csvRow(values: CsvValue[]): string {
  return values.map(csvEscape).join(',');
}

/** Builds a complete CSV body from a header + iterable of rows. */
export function csvBody(
  header: string[],
  rows: Iterable<CsvValue[]>,
): string {
  const lines: string[] = [header.join(',')];
  for (const row of rows) lines.push(csvRow(row));
  return lines.join('\n') + '\n';
}

/** Convenience for a filename like
 *  `wishlists-meanblvd-2026-06-02.csv`. */
export function csvFilename(prefix: string, shopDomain: string): string {
  const handle = shopDomain.replace('.myshopify.com', '');
  const date = new Date().toISOString().slice(0, 10);
  return `${prefix}-${handle}-${date}.csv`;
}
