export interface SkuCostRow {
  sku: string;
  cost: string;            // keep as string; downstream Drizzle numeric needs strings
  currency: string;
  effectiveFrom: string;   // YYYY-MM-DD
}

export interface CsvError {
  line: number;
  message: string;
}

export interface ParseResult {
  rows: SkuCostRow[];
  errors: CsvError[];
}

export function parseSkuCostsCsv(text: string, today: Date = new Date()): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const errors: CsvError[] = [];
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'empty file' }] };
  }
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const required = ['sku', 'cost', 'currency', 'effective_from'];
  for (const r of required) {
    if (!header.includes(r)) errors.push({ line: 1, message: `missing header: ${r}` });
  }
  if (errors.length > 0) return { rows: [], errors };

  const idx = (k: string) => header.indexOf(k);
  const todayIso = today.toISOString().slice(0, 10);

  const rows: SkuCostRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((s) => s.trim());
    const sku = cells[idx('sku')];
    const cost = cells[idx('cost')];
    const currency = cells[idx('currency')];
    const effectiveFrom = cells[idx('effective_from')] || todayIso;

    if (!sku) { errors.push({ line: i + 1, message: 'missing sku' }); continue; }
    if (!/^-?\d+(\.\d+)?$/.test(cost)) {
      errors.push({ line: i + 1, message: `cost must be numeric, got "${cost}"` }); continue;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ line: i + 1, message: `currency must be ISO-3, got "${currency}"` }); continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      errors.push({ line: i + 1, message: `effective_from must be YYYY-MM-DD, got "${effectiveFrom}"` }); continue;
    }
    rows.push({ sku, cost, currency, effectiveFrom });
  }
  return { rows, errors };
}
