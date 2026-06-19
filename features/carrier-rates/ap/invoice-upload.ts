import { parseDhlInvoiceCsv, dhlShipmentToBillLine } from './dhl-invoice-csv';
import { createBill } from './bills-actions';
import { reconcileDhlBill } from './dhl-reconcile-actions';
import { previewFboBill, applyFboBill } from './fbo-import-actions';

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

export interface InvoiceCtx { carrierKey: string | null; carrierAccountId: string; currency: string; userId: string }
export interface InvoiceImportResult { filename: string; ok: boolean; billNumber: string | null; amount: number | null; matched: number | null; freight: number | null; message: string | null }

const td = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export async function previewOneInvoice(ctx: InvoiceCtx, file: { bytes: Uint8Array; filename: string; contentType: string }) {
  const fmt = detectInvoiceFormat(ctx.carrierKey, file.filename);
  if (fmt === 'dhl_csv') {
    const p = parseDhlInvoiceCsv(td(file.bytes));
    if (!p || !p.billNumber) return { ok: false as const, message: 'Không đúng định dạng hoá đơn DHL.' };
    return { ok: true as const, preview: toInvoicePreview({ kind: 'dhl', p, accountCurrency: ctx.currency }) };
  }
  if (fmt === 'fbo_xlsx') {
    const fbo = await previewFboBill(file.bytes);
    const b = fbo.bills[0];
    if (!b) return { ok: false as const, message: 'Không đúng định dạng hoá đơn FedEx (FBO).' };
    return { ok: true as const, preview: toInvoicePreview({ kind: 'fbo', b, accountCurrency: ctx.currency }) };
  }
  return { ok: false as const, message: `File không đúng định dạng hoá đơn ${ctx.carrierKey === 'fedex' ? 'FedEx (XLSX)' : 'DHL (CSV)'}.` };
}

export async function importCarrierInvoices(ctx: InvoiceCtx, files: { bytes: Uint8Array; filename: string; contentType: string }[], existingBillNumbers: Set<string>): Promise<InvoiceImportResult[]> {
  const out: InvoiceImportResult[] = [];
  const seen = new Set(existingBillNumbers);
  for (const f of files) {
    const base: InvoiceImportResult = { filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
    const fmt = detectInvoiceFormat(ctx.carrierKey, f.filename);
    try {
      if (fmt === 'dhl_csv') {
        const p = parseDhlInvoiceCsv(td(f.bytes));
        if (!p || !p.billNumber) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn DHL' }); continue; }
        if (seen.has(p.billNumber)) { out.push({ ...base, billNumber: p.billNumber, message: 'Đã tồn tại — bỏ qua' }); continue; }
        const lines = p.shipments.map(dhlShipmentToBillLine);
        const { id: billId } = await createBill({ carrierAccountId: ctx.carrierAccountId, billNumber: p.billNumber, periodStart: p.periodStart, periodEnd: p.periodEnd, issueDate: p.issueDate, dueDate: p.dueDate, amount: p.amountInclVat, currency: ctx.currency, note: p.note, userId: ctx.userId, file: { bytes: f.bytes, filename: f.filename, contentType: 'text/csv' }, lines });
        seen.add(p.billNumber);
        const r = lines.length ? await reconcileDhlBill(billId) : null;
        out.push({ filename: f.filename, ok: true, billNumber: p.billNumber, amount: p.amountInclVat, matched: r?.matched ?? null, freight: r?.freightLines ?? null, message: null });
      } else if (fmt === 'fbo_xlsx') {
        const res = await applyFboBill({ carrierAccountId: ctx.carrierAccountId, currency: ctx.currency, userId: ctx.userId, bytes: f.bytes, filename: f.filename, contentType: f.contentType });
        const b = res.bills[0];
        if (b?.billNumber) seen.add(b.billNumber);
        out.push({ filename: f.filename, ok: true, billNumber: b?.billNumber ?? null, amount: b?.amount ?? null, matched: res.matchedAwb, freight: res.totalAwb, message: null });
      } else {
        out.push({ ...base, message: `Không đúng định dạng hoá đơn ${ctx.carrierKey === 'fedex' ? 'FedEx (XLSX)' : 'DHL (CSV)'}` });
      }
    } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý file' }); }
  }
  return out;
}
