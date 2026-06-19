/**
 * Parser hoá đơn DHL dạng CSV (file "DocumentDownload", phân tách bằng ';').
 * Cấu trúc: dòng header + 1 dòng `I` (tổng hoá đơn) + nhiều dòng `S` (shipment).
 * Bóc tổng hoá đơn (điền form) + breakdown từng shipment (bảng billed chi tiết).
 * Thuần, không I/O.
 */

/** Một khoản charge trong 1 shipment theo DHL (cước cân, thuế, phí phụ…). */
export interface DhlChargeLine {
  code: string;   // 'WEIGHT' | mã XC (XB/XX/DD/XI…)
  name: string;   // tên DHL ('Weight charge' / 'IMPORT EXPORT TAXES'…)
  charge: number; // trước thuế
  tax: number;    // VAT
  total: number;  // gồm thuế
}

export interface DhlShipment {
  shipmentNumber: string;
  orderRef: string;     // Shipment Reference 1 (#MBLVD…)
  date: string;         // YYYY-MM-DD
  product: string;      // Product Name (vd 'DUTIES & TAXES')
  weightKg: number;
  charges: DhlChargeLine[];
  totalExclVat: number;
  totalTax: number;
  totalInclVat: number;
}

export interface DhlInvoicePrefill {
  billNumber: string;
  currency: string;
  amountInclVat: number; // số phải trả (gồm VAT) — ô "Số tiền"
  amountExclVat: number;
  issueDate: string;     // YYYY-MM-DD (Invoice Date)
  dueDate: string;       // issueDate + 30 ngày
  periodStart: string;   // Shipment Date nhỏ nhất (fallback issueDate)
  periodEnd: string;     // Shipment Date lớn nhất (fallback issueDate)
  note: string;
  shipmentCount: number;
  shipments: DhlShipment[]; // bảng billed chi tiết
}

/** Dòng bill-line để lưu (khớp cột carrier_bill_lines). */
export interface DhlBillLineInput {
  trackingNumber: string;
  orderNumber: string | null;
  weightKg: number;
  base: number;   // cước cân (Weight charge)
  fuel: number;   // khoản XC tên có FUEL
  vat: number;    // tổng thuế shipment
  other: number;  // phí phụ khác (trừ fuel)
  total: number;  // gồm VAT
  note: string;   // liệt kê khoản
  shipDate: string | null;  // ngày đi hàng (Shipment Date) — điền label_created_at
  charges: DhlChargeLine[]; // breakdown chi tiết (lưu jsonb) để liệt kê đủ
}

function ymdToIso(raw: string): string {
  const s = (raw ?? '').trim();
  if (!/^\d{8}$/.test(s)) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function num(raw: string): number {
  const n = Number((raw ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/** Như num() nhưng GIỮ thập phân (2 số) — dùng cho CÂN (kg). num() làm tròn nguyên
 *  hợp cho tiền VND, nhưng kg cần giữ 0.5/1.2/2.04… Không round nguyên. */
function numKg(raw: string): number {
  const n = Number((raw ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function chargesFromRow(col: (n: string) => string): DhlChargeLine[] {
  const out: DhlChargeLine[] = [];
  const wc = num(col('Weight Charge'));
  if (wc !== 0) out.push({ code: 'WEIGHT', name: 'Weight charge', charge: wc, tax: num(col('Weight Tax (VAT)')), total: wc + num(col('Weight Tax (VAT)')) });
  for (let i = 1; i <= 9; i++) {
    const charge = num(col(`XC${i} Charge`));
    const total = num(col(`XC${i} Total`)) || charge + num(col(`XC${i} Tax`));
    if (charge === 0 && total === 0) continue; // bỏ slot trống (DHL điền '0' hoặc rỗng)
    const code = col(`XC${i} Code`);
    const name = col(`XC${i} Name`);
    out.push({ code: code === '0' ? '' : code, name: name === '0' ? '' : name, charge, tax: num(col(`XC${i} Tax`)), total });
  }
  return out;
}

/** Tách 1 dòng CSV theo delimiter, có xử lý ngoặc kép (RFC4180). */
function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseDhlInvoiceCsv(text: string): DhlInvoicePrefill | null {
  const lines = (text ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  // DHL xuất khi thì ';' không ngoặc, khi thì ',' có ngoặc kép — tự nhận delimiter.
  const delim = splitCsvLine(lines[0], ';').length >= splitCsvLine(lines[0], ',').length ? ';' : ',';
  const header = splitCsvLine(lines[0], delim).map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const colOf = (row: string[]) => (name: string) => { const i = idx(name); return i >= 0 ? (row[i] ?? '').trim() : ''; };

  const rows = lines.slice(1).map((l) => splitCsvLine(l, delim));
  const iLine = rows.find((r) => (r[0] ?? '').trim() === 'I');
  if (!iLine) return null;
  const iCol = colOf(iLine);
  const issueDate = ymdToIso(iCol('Invoice Date'));
  if (!issueDate) return null;

  const shipments: DhlShipment[] = rows
    .filter((r) => (r[0] ?? '').trim() === 'S')
    .map((r) => {
      const c = colOf(r);
      return {
        shipmentNumber: c('Shipment Number'),
        orderRef: c('Shipment Reference 1'),
        date: ymdToIso(c('Shipment Date')) || issueDate,
        product: c('Product Name'),
        weightKg: numKg(c('Weight (kg)')),
        charges: chargesFromRow(c),
        totalExclVat: num(c('Total amount (excl. VAT)')),
        totalTax: num(c('Total Tax')),
        totalInclVat: num(c('Total amount (incl. VAT)')),
      };
    });

  const shipDates = shipments.map((s) => s.date).filter(Boolean).sort();
  const refs = [...new Set(shipments.map((s) => s.orderRef).filter(Boolean))];
  const shipNos = [...new Set(shipments.map((s) => s.shipmentNumber).filter(Boolean))];
  const noteParts: string[] = [];
  if (refs.length) noteParts.push(refs.join(', '));
  if (shipNos.length) noteParts.push(`Shipment ${shipNos.join(', ')}`);

  return {
    billNumber: iCol('Invoice Number'),
    currency: iCol('Currency'),
    amountInclVat: num(iCol('Total amount (incl. VAT)')),
    amountExclVat: num(iCol('Total amount (excl. VAT)')),
    issueDate,
    dueDate: addDaysIso(issueDate, 30),
    periodStart: shipDates[0] ?? issueDate,
    periodEnd: shipDates[shipDates.length - 1] ?? issueDate,
    note: noteParts.join(' · '),
    shipmentCount: shipments.length,
    shipments,
  };
}

/** Map shipment DHL → dòng bill-line lưu DB (cột cố định + note liệt kê khoản). */
export function dhlShipmentToBillLine(s: DhlShipment): DhlBillLineInput {
  const base = s.charges.filter((x) => x.code === 'WEIGHT').reduce((a, x) => a + x.charge, 0);
  const fuel = s.charges.filter((x) => x.code !== 'WEIGHT' && /fuel/i.test(x.name)).reduce((a, x) => a + x.charge, 0);
  const other = s.charges.filter((x) => x.code !== 'WEIGHT' && !/fuel/i.test(x.name)).reduce((a, x) => a + x.charge, 0);
  const note = s.charges.map((x) => `${x.name || x.code} ${x.charge.toLocaleString('vi-VN')}`).join(' · ');
  return {
    trackingNumber: s.shipmentNumber,
    orderNumber: s.orderRef || null,
    weightKg: s.weightKg,
    base, fuel, other,
    vat: s.totalTax,
    total: s.totalInclVat,
    note,
    shipDate: s.date || null,
    charges: s.charges,
  };
}
