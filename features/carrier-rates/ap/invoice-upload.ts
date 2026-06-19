import { parseDhlInvoiceCsv, dhlShipmentToBillLine } from './dhl-invoice-csv';
import { createBill } from './bills-actions';
import { reconcileDhlBill } from './dhl-reconcile-actions';
import { previewFboBill, applyFboBill } from './fbo-import-actions';
import { extractPdfText } from '@/features/carrier-rates/import/pdf-text';
import { matchInvoiceNumbers } from './match-invoice-pdf';
import { compressPdf } from '@/lib/pdf/compress';
import { putObject } from '@/lib/storage/s3';
import { db, schema } from '@/db/client';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export type InvoiceFormat = 'dhl_csv' | 'fbo_xlsx' | 'invoice_pdf' | 'unsupported';

/** Nhận dạng định dạng theo carrier + đuôi file. DHL=CSV, FedEx=XLSX/XLS. PDF mọi carrier. */
export function detectInvoiceFormat(carrierKey: string | null, filename: string): InvoiceFormat {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (carrierKey === 'dhl' && ext === '.csv') return 'dhl_csv';
  if (carrierKey === 'fedex' && (ext === '.xlsx' || ext === '.xls')) return 'fbo_xlsx';
  if (ext === '.pdf') return 'invoice_pdf';
  return 'unsupported';
}

export interface InvoicePreview {
  carrier: 'fedex' | 'dhl'; format: InvoiceFormat; billNumber: string | null; amount: number | null; currency: string;
  periodStart: string | null; periodEnd: string | null; issueDate: string | null; dueDate: string | null;
  lineCount: number; warnings: string[];
}

/** Gộp các hoá đơn FBO (1 file FedEx có thể chứa nhiều invoice) thành 1 InvoicePreview. */
export function fboPreviewFrom(
  bills: { billNumber: string | null; periodStart: string | null; periodEnd: string | null; amount: number; lineCount: number }[],
  accountCurrency: string,
): InvoicePreview {
  if (bills.length === 1) return toInvoicePreview({ kind: 'fbo', b: bills[0], accountCurrency });
  const amount = bills.reduce((s, b) => s + (b.amount || 0), 0);
  const starts = bills.map((b) => b.periodStart).filter((d): d is string => !!d).sort();
  const ends = bills.map((b) => b.periodEnd).filter((d): d is string => !!d).sort();
  const lineCount = bills.reduce((s, b) => s + b.lineCount, 0);
  return {
    carrier: 'fedex', format: 'fbo_xlsx', billNumber: null, amount: amount || null, currency: accountCurrency,
    periodStart: starts[0] ?? null, periodEnd: ends[ends.length - 1] ?? null,
    issueDate: null, dueDate: null, lineCount,
    warnings: [`File chứa ${bills.length} hoá đơn — sẽ import tất cả.`],
  };
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
      carrier: 'dhl', format: 'dhl_csv', billNumber: p.billNumber || null, amount: p.amountInclVat || null, currency: accountCurrency,
      periodStart: p.periodStart || null, periodEnd: p.periodEnd || null, issueDate: p.issueDate || null, dueDate: p.dueDate || null,
      lineCount: p.shipments.length, warnings,
    };
  }
  const { b, accountCurrency } = src;
  return {
    carrier: 'fedex', format: 'fbo_xlsx', billNumber: b.billNumber, amount: b.amount || null, currency: accountCurrency,
    periodStart: b.periodStart, periodEnd: b.periodEnd, issueDate: null, dueDate: null,
    lineCount: b.lineCount, warnings: [],
  };
}

/** Tách danh sách file theo PHA xử lý dựa trên carrier + đuôi: spreadsheet
 *  (dhl_csv/fbo_xlsx) xử lý TRƯỚC để bill tồn tại, pdf (invoice_pdf) SAU, còn
 *  lại unsupported. Thuần — không I/O. */
export function splitByPhase<T extends { filename: string }>(files: T[], carrierKey: string | null): { spreadsheets: T[]; pdfs: T[]; unsupported: T[] } {
  const spreadsheets: T[] = [], pdfs: T[] = [], unsupported: T[] = [];
  for (const f of files) {
    const fmt = detectInvoiceFormat(carrierKey, f.filename);
    if (fmt === 'dhl_csv' || fmt === 'fbo_xlsx') spreadsheets.push(f);
    else if (fmt === 'invoice_pdf') pdfs.push(f);
    else unsupported.push(f);
  }
  return { spreadsheets, pdfs, unsupported };
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
    if (fbo.bills.length === 0) return { ok: false as const, message: 'Không đúng định dạng hoá đơn FedEx (FBO).' };
    return { ok: true as const, preview: fboPreviewFrom(fbo.bills, ctx.currency) };
  }
  if (fmt === 'invoice_pdf') {
    let text: string;
    try { text = await extractPdfText(file.bytes); }
    catch { return { ok: false as const, message: 'Không đọc được PDF' }; }
    const billRows = await db.select({ billNumber: schema.carrierBills.billNumber })
      .from(schema.carrierBills).where(eq(schema.carrierBills.carrierAccountId, ctx.carrierAccountId));
    const known = new Set(billRows.map((b) => b.billNumber).filter((n): n is string => !!n));
    const invoices = matchInvoiceNumbers(text, known);
    const carrier = (ctx.carrierKey === 'fedex' ? 'fedex' : 'dhl') as 'fedex' | 'dhl';
    return { ok: true as const, preview: {
      carrier, format: 'invoice_pdf' as const, billNumber: null, amount: null, currency: ctx.currency,
      periodStart: null, periodEnd: null, issueDate: null, dueDate: null, lineCount: invoices.length,
      warnings: invoices.length ? [`PDF sẽ đính vào ${invoices.length} bill: ${invoices.join(', ')}`] : ['Không khớp bill nào — import CSV/XLSX trước'],
    } };
  }
  return { ok: false as const, message: `File không đúng định dạng hoá đơn ${ctx.carrierKey === 'fedex' ? 'FedEx (XLSX)' : 'DHL (CSV)'}.` };
}

export async function importCarrierInvoices(ctx: InvoiceCtx, files: { bytes: Uint8Array; filename: string; contentType: string }[], existingBillNumbers: Set<string>): Promise<InvoiceImportResult[]> {
  const out: InvoiceImportResult[] = [];
  const seen = new Set(existingBillNumbers);
  const { spreadsheets, pdfs, unsupported } = splitByPhase(files, ctx.carrierKey);

  // Phase 1: spreadsheets (dhl_csv / fbo_xlsx) — create bills first
  for (const f of spreadsheets) {
    const base: InvoiceImportResult = { filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
    try {
      if (ctx.carrierKey === 'dhl') {
        const p = parseDhlInvoiceCsv(td(f.bytes));
        if (!p || !p.billNumber) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn DHL' }); continue; }
        if (seen.has(p.billNumber)) { out.push({ ...base, billNumber: p.billNumber, message: 'Đã tồn tại — bỏ qua' }); continue; }
        const lines = p.shipments.map(dhlShipmentToBillLine);
        const { id: billId } = await createBill({ carrierAccountId: ctx.carrierAccountId, billNumber: p.billNumber, periodStart: p.periodStart, periodEnd: p.periodEnd, issueDate: p.issueDate, dueDate: p.dueDate, amount: p.amountInclVat, currency: ctx.currency, note: p.note, userId: ctx.userId, file: { bytes: f.bytes, filename: f.filename, contentType: 'text/csv' }, lines });
        seen.add(p.billNumber);
        const r = lines.length ? await reconcileDhlBill(billId) : null;
        out.push({ filename: f.filename, ok: true, billNumber: p.billNumber, amount: p.amountInclVat, matched: r?.matched ?? null, freight: r?.freightLines ?? null, message: null });
      } else if (ctx.carrierKey === 'fedex') {
        const pre = await previewFboBill(f.bytes);
        if (!pre.bills.length) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn FedEx (FBO)' }); continue; }
        const nums = pre.bills.map((b) => b.billNumber).filter((n): n is string => !!n);
        if (nums.length && nums.every((n) => seen.has(n))) {
          out.push({ ...base, billNumber: nums.length === 1 ? nums[0] : `${nums.length} hoá đơn`, message: 'Đã tồn tại — bỏ qua' });
          continue;
        }
        const res = await applyFboBill({ carrierAccountId: ctx.carrierAccountId, currency: ctx.currency, userId: ctx.userId, bytes: f.bytes, filename: f.filename, contentType: f.contentType });
        const amount = res.bills.reduce((s, b) => s + (b.amount || 0), 0);
        const billNumber = res.bills.length === 1 ? (res.bills[0]?.billNumber ?? null) : `${res.bills.length} hoá đơn`;
        res.bills.forEach((b) => { if (b.billNumber) seen.add(b.billNumber); });
        out.push({ filename: f.filename, ok: true, billNumber, amount: amount || null, matched: res.matchedAwb, freight: res.totalAwb, message: `Tạo ${res.billsCreated}, cập nhật ${res.billsUpdated} hoá đơn` });
      }
    } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý file' }); }
  }

  // Push unsupported results
  for (const f of unsupported) {
    out.push({ filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: `Không đúng định dạng hoá đơn ${ctx.carrierKey === 'fedex' ? 'FedEx (XLSX)' : 'DHL (CSV)'}` });
  }

  // Phase 2: PDFs — query bills fresh from DB (includes bills just created above)
  if (pdfs.length > 0) {
    const billRows = await db.select({ id: schema.carrierBills.id, billNumber: schema.carrierBills.billNumber })
      .from(schema.carrierBills).where(eq(schema.carrierBills.carrierAccountId, ctx.carrierAccountId));
    const byNumber = new Map<string, string>();
    for (const b of billRows) if (b.billNumber) byNumber.set(b.billNumber, b.id);
    const known = new Set(byNumber.keys());
    for (const f of pdfs) {
      const base: InvoiceImportResult = { filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
      try {
        let text: string;
        try { text = await extractPdfText(f.bytes); }
        catch { out.push({ ...base, message: 'Không đọc được PDF' }); continue; }
        const invoices = matchInvoiceNumbers(text, known);
        if (invoices.length === 0) { out.push({ ...base, message: 'Không khớp bill nào — import CSV/XLSX trước' }); continue; }
        const ct = f.contentType || 'application/pdf';
        const stored = await compressPdf(f.bytes);
        const fileKey = `carrier-bills/${ctx.carrierAccountId}/pdf-${randomUUID()}.pdf`;
        await putObject(fileKey, stored, ct);
        for (const inv of invoices) {
          await db.update(schema.carrierBills)
            .set({ pdfFileKey: fileKey, pdfFilename: f.filename, pdfContentType: ct, pdfByteSize: stored.length })
            .where(eq(schema.carrierBills.id, byNumber.get(inv)!));
        }
        out.push({ filename: f.filename, ok: true, billNumber: invoices.length === 1 ? invoices[0] : `${invoices.length} bill`, amount: null, matched: null, freight: null, message: `Đính PDF vào ${invoices.length} bill` });
      } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý PDF' }); }
    }
  }

  return out;
}
