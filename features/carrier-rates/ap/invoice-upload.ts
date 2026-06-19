export type InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'unsupported';

/** Nhận dạng định dạng theo carrier + đuôi file. DHL=CSV, FedEx=XLSX/XLS. */
export function detectInvoiceFormat(carrierKey: string | null, filename: string): InvoiceFormat {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (carrierKey === 'dhl' && ext === '.csv') return 'dhl_csv';
  if (carrierKey === 'fedex' && (ext === '.xlsx' || ext === '.xls')) return 'fbo_xlsx';
  return 'unsupported';
}

export interface InvoicePreview {
  carrier: 'fedex' | 'dhl'; billNumber: string | null; amount: number | null; currency: string;
  periodStart: string | null; periodEnd: string | null; issueDate: string | null; dueDate: string | null;
  lineCount: number; warnings: string[];
}

export function toInvoicePreview(src:
  | { kind: 'dhl'; p: { billNumber: string; amountInclVat: number; periodStart: string; periodEnd: string; issueDate: string; dueDate: string; currency: string; shipments: unknown[] }; accountCurrency: string }
  | { kind: 'fbo'; b: { billNumber: string | null; periodStart: string | null; periodEnd: string | null; amount: number; lineCount: number }; accountCurrency: string },
): InvoicePreview {
  if (src.kind === 'dhl') {
    const { p, accountCurrency } = src;
    const warnings: string[] = [];
    if (p.currency && p.currency !== accountCurrency) warnings.push(`File là ${p.currency} nhưng tài khoản là ${accountCurrency} — kiểm tra lại số tiền.`);
    return {
      carrier: 'dhl', billNumber: p.billNumber || null, amount: p.amountInclVat || null, currency: accountCurrency,
      periodStart: p.periodStart || null, periodEnd: p.periodEnd || null, issueDate: p.issueDate || null, dueDate: p.dueDate || null,
      lineCount: p.shipments.length, warnings,
    };
  }
  const { b, accountCurrency } = src;
  return {
    carrier: 'fedex', billNumber: b.billNumber, amount: b.amount || null, currency: accountCurrency,
    periodStart: b.periodStart, periodEnd: b.periodEnd, issueDate: null, dueDate: null,
    lineCount: b.lineCount, warnings: [],
  };
}
