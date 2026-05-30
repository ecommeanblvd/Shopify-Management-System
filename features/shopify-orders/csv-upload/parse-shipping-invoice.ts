export interface ShippingInvoiceRow {
  trackingNumber: string;
  actualCost: string;
  currency: string;
  date: string; // YYYY-MM-DD
}

export interface CsvError { line: number; message: string }

export interface ParseResult {
  rows: ShippingInvoiceRow[];
  errors: CsvError[];
}

export function parseShippingInvoiceCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const errors: CsvError[] = [];
  if (lines.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'empty file' }] };
  }
  const header = lines[0].split(',').map((s) => s.trim().toLowerCase());
  const required = ['tracking_number', 'actual_cost', 'currency', 'date'];
  for (const r of required) {
    if (!header.includes(r)) errors.push({ line: 1, message: `missing header: ${r}` });
  }
  if (errors.length > 0) return { rows: [], errors };

  const idx = (k: string) => header.indexOf(k);
  const rows: ShippingInvoiceRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((s) => s.trim());
    const trackingNumber = cells[idx('tracking_number')];
    const actualCost = cells[idx('actual_cost')];
    const currency = cells[idx('currency')];
    const date = cells[idx('date')];

    if (!trackingNumber) { errors.push({ line: i + 1, message: 'missing tracking_number' }); continue; }
    if (!/^-?\d+(\.\d+)?$/.test(actualCost)) {
      errors.push({ line: i + 1, message: `cost must be numeric, got "${actualCost}"` }); continue;
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      errors.push({ line: i + 1, message: `currency must be ISO-3, got "${currency}"` }); continue;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      errors.push({ line: i + 1, message: `date must be YYYY-MM-DD, got "${date}"` }); continue;
    }
    rows.push({ trackingNumber, actualCost, currency, date });
  }
  return { rows, errors };
}
