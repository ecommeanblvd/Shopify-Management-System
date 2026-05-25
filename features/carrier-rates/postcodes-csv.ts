// Pure parser for the remote-area postcode CSV upload. Mirrors matrix-csv.ts:
// kept out of the 'use server' actions file so it can stay synchronous and
// unit-testable without exposing it as a server action.

export interface PostcodeRow {
  country: string;
  pattern: string;
}

export interface ParsedPostcodeCsv {
  rows: PostcodeRow[];
  warnings: string[];
}

const ISO2_RE = /^[A-Z]{2}$/;

/**
 * Parses a postcode CSV. Accepted shapes:
 *
 *   country,postcode
 *   VN,710000
 *   VN,711000
 *   TH,10100
 *
 * Header row is optional — if the first line looks like 'country' / 'postcode'
 * / 'postal' tokens, it's skipped.
 *
 * Each row is one (country, pattern). Empty cells and lines starting with `#`
 * are skipped quietly.
 */
export function parsePostcodeCsv(csv: string): ParsedPostcodeCsv {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
  if (lines.length === 0) return { rows: [], warnings: ['CSV is empty'] };

  const rows: PostcodeRow[] = [];
  const warnings: string[] = [];

  let startIdx = 0;
  const headerCells = lines[0].split(',').map((s) => s.trim().toLowerCase());
  if (headerCells.includes('country') || headerCells.includes('postal') || headerCells.includes('postcode')) {
    startIdx = 1;
  }

  for (let i = startIdx; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((s) => s.trim());
    if (cells.length < 2) {
      warnings.push(`Line ${i + 1}: needs at least two columns (country, postcode) — skipped`);
      continue;
    }
    const country = cells[0].toUpperCase();
    const pattern = cells[1];
    if (!ISO2_RE.test(country)) {
      warnings.push(`Line ${i + 1}: "${cells[0]}" is not a valid ISO-2 country code — skipped`);
      continue;
    }
    if (!pattern) {
      warnings.push(`Line ${i + 1}: empty postcode — skipped`);
      continue;
    }
    rows.push({ country, pattern });
  }

  // De-duplicate (country, pattern) pairs within the file
  const seen = new Set<string>();
  const deduped: PostcodeRow[] = [];
  let dupCount = 0;
  for (const r of rows) {
    const key = `${r.country}::${r.pattern}`;
    if (seen.has(key)) {
      dupCount += 1;
      continue;
    }
    seen.add(key);
    deduped.push(r);
  }
  if (dupCount > 0) {
    warnings.push(`${dupCount} duplicate (country, postcode) pair${dupCount === 1 ? '' : 's'} collapsed`);
  }

  return { rows: deduped, warnings };
}
