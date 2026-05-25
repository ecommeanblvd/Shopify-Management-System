// Pure CSV-parser helpers for the rate matrix. Kept out of matrix-actions.ts
// because that file is "use server" and Next.js requires every export there to
// be an async function — these helpers are intentionally synchronous so the
// matrix UI can call them inline before deciding whether to commit.

export interface MatrixCsvRow {
  upperKg: number;
  rates: { zoneLabel: string; cost: number }[];
}

export interface ParsedMatrixCsv {
  zoneLabels: string[];
  rows: MatrixCsvRow[];
  warnings: string[];
}

/**
 * Parses a rate matrix CSV string. Expected shape:
 *
 *   ,Zone 1,Zone 2,Zone 3
 *   0.5,180000,210000,260000
 *   1.0,260000,310000,380000
 *
 * Header row first cell is ignored. Empty cells produce no rate entry for that
 * (zone, tier) pair (caller decides whether to clear or skip).
 */
export function parseMatrixCsv(csv: string): ParsedMatrixCsv {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) return { zoneLabels: [], rows: [], warnings: ['CSV is empty'] };

  const warnings: string[] = [];

  const header = splitCsvLine(lines[0]);
  if (header.length < 2) warnings.push('Header row has no zone columns');
  const zoneLabels = header.slice(1).map((s) => s.trim()).filter((s) => s.length > 0);

  const rows: MatrixCsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length === 0) continue;
    const upperRaw = cells[0]?.trim() ?? '';
    if (!upperRaw) continue;
    const upper = Number(upperRaw);
    if (!Number.isFinite(upper) || upper <= 0) {
      warnings.push(`Row ${i + 1}: weight "${upperRaw}" is not a positive number — skipped`);
      continue;
    }
    const rates: { zoneLabel: string; cost: number }[] = [];
    for (let z = 0; z < zoneLabels.length; z += 1) {
      const raw = cells[z + 1]?.trim() ?? '';
      if (!raw) continue;
      const n = Number(raw.replace(/[,_\s]/g, ''));
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`Row ${i + 1}, column "${zoneLabels[z]}": "${raw}" is not a non-negative number — skipped`);
        continue;
      }
      rates.push({ zoneLabel: zoneLabels[z], cost: n });
    }
    rows.push({ upperKg: upper, rates });
  }

  return { zoneLabels, rows, warnings };
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV splitter — no quoted-field support. Sufficient for numeric rate sheets.
  return line.split(',');
}
