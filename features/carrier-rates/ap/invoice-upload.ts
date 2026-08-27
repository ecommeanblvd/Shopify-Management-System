import { parseDhlInvoiceCsv, dhlShipmentToBillLine } from './dhl-invoice-csv';
import { parseDhlInvoiceXml } from './dhl-invoice-xml';
import { parsePdfInvoiceTotals } from './pdf-invoice-totals';
import { createBill } from './bills-actions';
import { reconcileDhlBill } from './dhl-reconcile-actions';
import { previewFboBill, previewFboRows, applyFboBill } from './fbo-import-actions';
import { parseFedexInvoiceXml } from '@/features/shipments/fedex-invoice-xml';
import { parseVnEInvoiceXml, parseVnEInvoicePdfText, type VnEInvoice } from './vn-einvoice';
import { vnInvoiceToBill } from './vn-einvoice-bill';
import { parseHncManifestRows, type HncManifest } from './hnc-manifest';
import { ghepBangKeVoiHoaDon } from './hnc-bill';
import { ghepCapBangKeHoaDon } from './hnc-pairing';
import { ghiBilledAramex } from './aramex-billed';
import * as XLSX from 'xlsx';
import { extractPdfText } from '@/features/carrier-rates/import/pdf-text';
import { matchInvoiceNumbers } from './match-invoice-pdf';
import { compressPdf } from '@/lib/pdf/compress';
import { putObject } from '@/lib/storage/s3';
import { db, schema } from '@/db/client';
import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';

export type InvoiceFormat = 'dhl_csv' | 'dhl_xml' | 'fbo_xlsx' | 'fedex_xml' | 'aramex_xlsx' | 'aramex_xml' | 'aramex_pdf' | 'invoice_pdf' | 'unsupported';

/** Nhận dạng định dạng theo carrier + đuôi file. DHL=CSV/XML, FedEx=XLSX/XML,
 *  Aramex=XML/PDF hoá đơn điện tử Việt Nam. PDF các carrier khác chỉ để đính kèm. */
export function detectInvoiceFormat(carrierKey: string | null, filename: string): InvoiceFormat {
  const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
  if (carrierKey === 'dhl' && ext === '.csv') return 'dhl_csv';
  if (carrierKey === 'dhl' && ext === '.xml') return 'dhl_xml';
  if (carrierKey === 'fedex' && (ext === '.xlsx' || ext === '.xls')) return 'fbo_xlsx';
  if (carrierKey === 'fedex' && ext === '.xml') return 'fedex_xml';
  // Aramex Việt Nam (Hợp Nhất) phát hành hoá đơn điện tử: bản XML và bản in
  // PDF chứa CÙNG nội dung, nên PDF ở đây dựng được bill chứ không chỉ đính
  // kèm như PDF của FedEx/DHL.
  // Bảng kê Excel là nguồn CHI TIẾT (cân nặng, nước đến, cước gốc, phụ phí
  // xăng dầu, tỉ giá); hoá đơn XML bổ sung số hoá đơn + thuế + chữ ký số. Hợp
  // Nhất đặt đuôi .xls nhưng ruột là xlsx.
  if (carrierKey === 'aramex' && (ext === '.xls' || ext === '.xlsx')) return 'aramex_xlsx';
  if (carrierKey === 'aramex' && ext === '.xml') return 'aramex_xml';
  if (carrierKey === 'aramex' && ext === '.pdf') return 'aramex_pdf';
  if (ext === '.pdf') return 'invoice_pdf';
  return 'unsupported';
}

export interface InvoicePreview {
  carrier: 'fedex' | 'dhl' | 'aramex'; format: InvoiceFormat; billNumber: string | null; amount: number | null; currency: string;
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
    if (fmt === 'dhl_csv' || fmt === 'dhl_xml' || fmt === 'fbo_xlsx' || fmt === 'fedex_xml' || fmt === 'aramex_xml' || fmt === 'aramex_xlsx') spreadsheets.push(f);
    else if (fmt === 'invoice_pdf' || fmt === 'aramex_pdf') pdfs.push(f);
    else unsupported.push(f);
  }
  return { spreadsheets, pdfs, unsupported };
}

export interface InvoiceCtx {
  carrierKey: string | null;
  carrierAccountId: string;
  /** Đồng CHI PHÍ của tài khoản (bảng giá tính bằng đồng này). */
  currency: string;
  /** Đồng HIỂN THỊ, khi khác đồng chi phí (Aramex: giá USD, hiển thị VND). */
  displayCurrency?: string;
  userId: string;
}
export interface InvoiceImportResult { filename: string; ok: boolean; billNumber: string | null; amount: number | null; matched: number | null; freight: number | null; message: string | null }

const td = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/**
 * Nối dòng bill với shipment theo số vận đơn. Hoá đơn Việt Nam chỉ có vận đơn
 * (không có mã đơn), nên đây là đường duy nhất để đối soát biết dòng bill này
 * thuộc đơn nào.
 */
async function napShipmentChoDongBill(billId: string): Promise<{ khop: number; tong: number }> {
  await db.execute(sql`
    UPDATE carrier_bill_lines l
       SET shipment_id = s.id
      FROM shipments s
     WHERE l.bill_id = ${billId}
       AND l.tracking_number IS NOT NULL
       AND s.tracking_number = l.tracking_number`);
  const r = await db.execute(sql`
    SELECT count(*)::int AS tong, count(shipment_id)::int AS khop
      FROM carrier_bill_lines WHERE bill_id = ${billId}`);
  const row = (r.rows ?? [])[0] as { tong: number; khop: number } | undefined;
  return { khop: row?.khop ?? 0, tong: row?.tong ?? 0 };
}

/** Đọc bảng kê Excel của Hợp Nhất. Trả null khi file không phải bảng kê. */
export function docBangKeHnc(bytes: Uint8Array): HncManifest | null {
  try {
    const wb = XLSX.read(bytes, { type: 'array' });
    for (const ten of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[ten], { header: 1, raw: true, defval: null });
      const m = parseHncManifestRows(rows);
      if (m) return m;
    }
  } catch {
    return null;
  }
  return null;
}

/** Nhập một hoá đơn điện tử Việt Nam (Aramex/Hợp Nhất) thành bill + dòng bill. */
async function nhapHoaDonVn(
  ctx: InvoiceCtx,
  inv: NonNullable<ReturnType<typeof parseVnEInvoiceXml>>,
  file: { bytes: Uint8Array; filename: string; contentType: string } | null,
): Promise<InvoiceImportResult> {
  const b = vnInvoiceToBill(inv, ctx.currency, ctx.displayCurrency);
  const { id: billId } = await createBill({
    carrierAccountId: ctx.carrierAccountId,
    billNumber: b.billNumber,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    issueDate: b.issueDate,
    dueDate: null,
    amount: b.amount,
    // Tiền tệ theo HOÁ ĐƠN, không theo tài khoản — xem vn-einvoice-bill.ts.
    currency: b.currency,
    note: b.note,
    userId: ctx.userId,
    file: file ? { bytes: file.bytes, filename: file.filename, contentType: file.contentType } : null,
    lines: b.lines.map((l) => ({
      trackingNumber: l.trackingNumber,
      base: l.base,
      discount: l.discount,
      vat: l.vat,
      total: l.total,
      note: l.note,
    })),
  });
  const { khop, tong } = await napShipmentChoDongBill(billId);
  const canhBao = b.warnings.length ? ' · ' + b.warnings.join(' · ') : '';
  return {
    filename: file?.filename ?? `${b.billNumber}.pdf`,
    ok: true,
    billNumber: b.billNumber,
    amount: b.amount,
    matched: khop,
    freight: tong,
    message: `Khớp ${khop}/${tong} vận đơn với đơn trong hệ thống${canhBao}`,
  };
}

export async function previewOneInvoice(ctx: InvoiceCtx, file: { bytes: Uint8Array; filename: string; contentType: string }) {
  const fmt = detectInvoiceFormat(ctx.carrierKey, file.filename);
  if (fmt === 'dhl_csv' || fmt === 'dhl_xml') {
    const p = fmt === 'dhl_xml' ? parseDhlInvoiceXml(td(file.bytes)) : parseDhlInvoiceCsv(td(file.bytes));
    if (!p || !p.billNumber) return { ok: false as const, message: 'Không đúng định dạng hoá đơn DHL.' };
    return { ok: true as const, preview: toInvoicePreview({ kind: 'dhl', p, accountCurrency: ctx.currency }) };
  }
  if (fmt === 'fbo_xlsx' || fmt === 'fedex_xml') {
    const fbo = fmt === 'fedex_xml'
      ? await previewFboRows(parseFedexInvoiceXml(td(file.bytes)))
      : await previewFboBill(file.bytes);
    if (fbo.bills.length === 0) return { ok: false as const, message: 'Không đúng định dạng hoá đơn FedEx (FBO/XML).' };
    return { ok: true as const, preview: fboPreviewFrom(fbo.bills, ctx.currency) };
  }
  if (fmt === 'aramex_xlsx') {
    const m = docBangKeHnc(file.bytes);
    if (!m) return { ok: false as const, message: 'Không đúng định dạng bảng kê cước Hợp Nhất.' };
    const b = ghepBangKeVoiHoaDon(m, null);
    return { ok: true as const, preview: {
      carrier: 'aramex' as const, format: fmt, billNumber: b.billNumber, amount: b.amount, currency: b.currency,
      periodStart: b.periodStart, periodEnd: b.periodEnd, issueDate: b.issueDate, dueDate: null,
      lineCount: b.lines.length, warnings: b.warnings,
    } };
  }
  if (fmt === 'aramex_xml' || fmt === 'aramex_pdf') {
    let inv;
    if (fmt === 'aramex_xml') {
      inv = parseVnEInvoiceXml(td(file.bytes));
    } else {
      let text: string;
      try { text = await extractPdfText(file.bytes); }
      catch { return { ok: false as const, message: 'Không đọc được PDF' }; }
      inv = parseVnEInvoicePdfText(text);
    }
    if (!inv) return { ok: false as const, message: 'Không đúng định dạng hoá đơn điện tử Việt Nam (Aramex/Hợp Nhất).' };
    const b = vnInvoiceToBill(inv, ctx.currency, ctx.displayCurrency);
    return { ok: true as const, preview: {
      carrier: 'aramex' as const, format: fmt, billNumber: b.billNumber, amount: b.amount, currency: b.currency,
      periodStart: b.periodStart, periodEnd: b.periodEnd, issueDate: b.issueDate, dueDate: null,
      lineCount: b.lines.length, warnings: b.warnings,
    } };
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
  const dinhDang = ctx.carrierKey === 'fedex' ? 'FedEx (XLSX/XML)'
    : ctx.carrierKey === 'aramex' ? 'Aramex (XML/PDF hoá đơn điện tử)'
    : 'DHL (CSV/XML)';
  return { ok: false as const, message: `File không đúng định dạng hoá đơn ${dinhDang}.` };
}

type TepTai = { bytes: Uint8Array; filename: string; contentType: string };

/**
 * Aramex nhập theo BỘ HỒ SƠ, không theo từng file: bảng kê Excel giữ phần chi
 * tiết còn hoá đơn XML giữ số hoá đơn và thuế, phải ghép lại mới ra một bill
 * đầy đủ. Xử lý rời từng file sẽ đẻ ra hai bill của cùng một kỳ.
 */
async function nhapHoSoAramex(ctx: InvoiceCtx, files: TepTai[]): Promise<InvoiceImportResult[]> {
  const out: InvoiceImportResult[] = [];
  const loi = (f: TepTai, message: string): InvoiceImportResult =>
    ({ filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message });

  const bangKes: Array<{ tong: number; ten: string; m: HncManifest; f: TepTai }> = [];
  const hoaDons: Array<{ tong: number; ten: string; inv: VnEInvoice; f: TepTai }> = [];
  const pdfs: TepTai[] = [];

  for (const f of files) {
    const fmt = detectInvoiceFormat('aramex', f.filename);
    if (fmt === 'aramex_xlsx') {
      const m = docBangKeHnc(f.bytes);
      if (!m) { out.push(loi(f, 'Không đúng định dạng bảng kê cước Hợp Nhất')); continue; }
      bangKes.push({ tong: m.amountInclVat ?? 0, ten: f.filename, m, f });
    } else if (fmt === 'aramex_xml') {
      const inv = parseVnEInvoiceXml(td(f.bytes));
      if (!inv) { out.push(loi(f, 'Không đúng định dạng hoá đơn điện tử Việt Nam')); continue; }
      hoaDons.push({ tong: inv.amountInclVat, ten: f.filename, inv, f });
    } else if (fmt === 'aramex_pdf') {
      pdfs.push(f);
    } else {
      out.push(loi(f, 'Aramex nhận bảng kê Excel (.xls) và hoá đơn XML'));
    }
  }

  const { cap, hoaDonThua, warnings } = ghepCapBangKeHoaDon(bangKes, hoaDons);
  const soHoaDonDaTao: string[] = [];

  for (const c of cap) {
    const b = ghepBangKeVoiHoaDon(c.bangKe.m, c.hoaDon?.inv ?? null);
    const canhBao = [...warnings, ...b.warnings];
    try {
      const { id: billId } = await createBill({
        carrierAccountId: ctx.carrierAccountId,
        billNumber: b.billNumber,
        periodStart: b.periodStart,
        periodEnd: b.periodEnd,
        issueDate: b.issueDate,
        dueDate: null,
        amount: b.amount,
        currency: b.currency,
        // Tỉ giá của CHÍNH kỳ này — đối soát dùng nó thay vì tỉ giá tài khoản.
        fxRate: b.fxRate,
        note: b.note,
        userId: ctx.userId,
        // Giữ bảng kê làm file nguồn: đây mới là bản có chi tiết.
        file: { bytes: c.bangKe.f.bytes, filename: c.bangKe.f.filename, contentType: c.bangKe.f.contentType },
        lines: b.lines.map((l) => ({
          trackingNumber: l.trackingNumber,
          weightKg: l.weightKg,
          base: l.base,
          fuel: l.fuel,
          other: l.other,
          vat: l.vat,
          total: l.total,
          shipDate: l.shipDate,
          note: l.note,
          charges: l.charges,
        })),
      });
      const { khop, tong } = await napShipmentChoDongBill(billId);
      // Đẩy số hãng đã thu vào đối soát ship.
      const billed = await ghiBilledAramex(billId);
      soHoaDonDaTao.push(b.billNumber);
      const ten = [c.bangKe.ten, c.hoaDon?.ten].filter(Boolean).join(' + ');
      out.push({
        filename: ten,
        ok: true,
        billNumber: b.billNumber,
        amount: b.amount,
        matched: khop,
        freight: tong,
        message: `Khớp ${khop}/${tong} vận đơn · đẩy ${billed.khop} dòng vào đối soát${canhBao.length ? ' · ' + canhBao.join(' · ') : ''}`,
      });
    } catch (e) {
      out.push(loi(c.bangKe.f, (e as Error).message || 'Lỗi tạo hoá đơn'));
    }
  }

  // Hoá đơn không có bảng kê: vẫn nhập được nhưng thiếu hẳn cân nặng và phụ phí.
  for (const h of hoaDonThua) {
    try {
      const r = await nhapHoaDonVn(ctx, h.inv, h.f);
      soHoaDonDaTao.push(h.inv.billNumber);
      out.push({ ...r, message: `${r.message ?? ''} · Thiếu bảng kê Excel nên không có cân nặng, nước đến và phụ phí — đối soát chỉ so được tổng.` });
    } catch (e) {
      out.push(loi(h.f, (e as Error).message || 'Lỗi tạo hoá đơn'));
    }
  }

  for (const f of pdfs) {
    out.push(loi(f, 'PDF chỉ là bản in của hoá đơn XML — không cần tải. Bộ cần tải là bảng kê Excel + hoá đơn XML.'));
  }

  return out;
}

export async function importCarrierInvoices(ctx: InvoiceCtx, files: { bytes: Uint8Array; filename: string; contentType: string }[], existingBillNumbers: Set<string>): Promise<InvoiceImportResult[]> {
  if (ctx.carrierKey === 'aramex') return nhapHoSoAramex(ctx, files);
  const out: InvoiceImportResult[] = [];
  const seen = new Set(existingBillNumbers);
  const { spreadsheets, pdfs, unsupported } = splitByPhase(files, ctx.carrierKey);

  // Phase 1: spreadsheets (dhl_csv / fbo_xlsx) — create bills first
  for (const f of spreadsheets) {
    const base: InvoiceImportResult = { filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: null };
    try {
      if (ctx.carrierKey === 'dhl') {
        const isXml = detectInvoiceFormat('dhl', f.filename) === 'dhl_xml';
        const p = isXml ? parseDhlInvoiceXml(td(f.bytes)) : parseDhlInvoiceCsv(td(f.bytes));
        if (!p || !p.billNumber) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn DHL' }); continue; }
        // KHÔNG bỏ qua khi trùng: createBill upsert bill cũ + reconcileDhlBill CHỈ
        // ghi shipment_charges có thay đổi → giữ nguyên đơn đã đối soát.
        const lines = p.shipments.map(dhlShipmentToBillLine);
        const { id: billId } = await createBill({ carrierAccountId: ctx.carrierAccountId, billNumber: p.billNumber, periodStart: p.periodStart, periodEnd: p.periodEnd, issueDate: p.issueDate, dueDate: p.dueDate, amount: p.amountInclVat, currency: ctx.currency, note: p.note, userId: ctx.userId, file: { bytes: f.bytes, filename: f.filename, contentType: isXml ? 'application/xml' : 'text/csv' }, lines });
        seen.add(p.billNumber);
        const r = lines.length ? await reconcileDhlBill(billId) : null;
        out.push({ filename: f.filename, ok: true, billNumber: p.billNumber, amount: p.amountInclVat, matched: r?.matched ?? null, freight: r?.freightLines ?? null, message: null });
      } else if (ctx.carrierKey === 'fedex') {
        // XML (FedEx Billing Online "Download") hay XLSX (FBO) — cùng pipeline FboBilledRow.
        const xmlRows = detectInvoiceFormat('fedex', f.filename) === 'fedex_xml' ? parseFedexInvoiceXml(td(f.bytes)) : null;
        const pre = xmlRows ? await previewFboRows(xmlRows) : await previewFboBill(f.bytes);
        if (!pre.bills.length) { out.push({ ...base, message: 'Không đúng định dạng hoá đơn FedEx (FBO/XML)' }); continue; }
        // KHÔNG bỏ qua khi bill trùng: re-import = applyFboBill CHỈ ghi shipment_charges
        // có thay đổi (giữ nguyên đơn đã đối soát). Bill mới thì tạo, trùng thì cập nhật.
        const res = await applyFboBill({ carrierAccountId: ctx.carrierAccountId, currency: ctx.currency, userId: ctx.userId, bytes: f.bytes, filename: f.filename, contentType: f.contentType, ...(xmlRows ? { rows: xmlRows } : {}) });
        const amount = res.bills.reduce((s, b) => s + (b.amount || 0), 0);
        const billNumber = res.bills.length === 1 ? (res.bills[0]?.billNumber ?? null) : `${res.bills.length} hoá đơn`;
        res.bills.forEach((b) => { if (b.billNumber) seen.add(b.billNumber); });
        out.push({ filename: f.filename, ok: true, billNumber, amount: amount || null, matched: res.matchedAwb, freight: res.totalAwb, message: `Tạo ${res.billsCreated}, cập nhật ${res.billsUpdated} hoá đơn` });
      }
    } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý file' }); }
  }

  // Push unsupported results
  for (const f of unsupported) {
    const dinhDang = ctx.carrierKey === 'fedex' ? 'FedEx (XLSX/XML)' : ctx.carrierKey === 'aramex' ? 'Aramex (XML/PDF hoá đơn điện tử)' : 'DHL (CSV/XML)';
    out.push({ filename: f.filename, ok: false, billNumber: null, amount: null, matched: null, freight: null, message: `Không đúng định dạng hoá đơn ${dinhDang}` });
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
        const carrier = ctx.carrierKey === 'fedex' ? 'fedex' : 'dhl';
        const totals = parsePdfInvoiceTotals(text, carrier);
        const ct = f.contentType || 'application/pdf';
        const stored = await compressPdf(f.bytes);
        const fileKey = `carrier-bills/${ctx.carrierAccountId}/pdf-${randomUUID()}.pdf`;
        await putObject(fileKey, stored, ct);
        for (const inv of invoices) {
          const t = totals[inv];
          await db.update(schema.carrierBills)
            .set({
              pdfFileKey: fileKey, pdfFilename: f.filename, pdfContentType: ct, pdfByteSize: stored.length,
              pdfAmount: t ? String(t.total) : null,
              pdfIssueDate: t?.issueDate ?? null,
              pdfDueDate: t?.dueDate ?? null,
            })
            .where(eq(schema.carrierBills.id, byNumber.get(inv)!));
        }
        out.push({ filename: f.filename, ok: true, billNumber: invoices.length === 1 ? invoices[0] : `${invoices.length} bill`, amount: null, matched: null, freight: null, message: `Đính PDF vào ${invoices.length} bill` });
      } catch (e) { out.push({ ...base, message: (e as Error).message || 'Lỗi xử lý PDF' }); }
    }
  }

  return out;
}
