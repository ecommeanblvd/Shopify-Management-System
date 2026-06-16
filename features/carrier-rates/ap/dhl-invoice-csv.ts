/**
 * Parser hoá đơn DHL dạng CSV (file "DocumentDownload", phân tách bằng ';').
 * Cấu trúc: dòng header + 1 dòng `I` (tổng hoá đơn) + nhiều dòng `S` (shipment).
 * Dùng để tự điền form Thêm hoá đơn. Thuần, không I/O.
 */

export interface DhlInvoicePrefill {
  billNumber: string;
  currency: string;
  amountInclVat: number; // số phải trả (gồm VAT) — dùng cho ô "Số tiền"
  amountExclVat: number;
  issueDate: string;     // YYYY-MM-DD (Invoice Date)
  dueDate: string;       // issueDate + 30 ngày (quy ước chuẩn)
  periodStart: string;   // Shipment Date nhỏ nhất (fallback issueDate)
  periodEnd: string;     // Shipment Date lớn nhất (fallback issueDate)
  note: string;          // refs + shipment numbers
  shipmentCount: number;
}

/** 'YYYYMMDD' → 'YYYY-MM-DD'. Trả '' nếu không hợp lệ. */
function ymdToIso(raw: string): string {
  const s = (raw ?? '').trim();
  if (!/^\d{8}$/.test(s)) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Cộng n ngày vào ISO date (UTC, tránh lệch timezone). */
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function num(raw: string): number {
  const n = Number((raw ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function parseDhlInvoiceCsv(text: string): DhlInvoicePrefill | null {
  const lines = (text ?? '').split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const header = lines[0].split(';').map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const col = (row: string[], name: string) => { const i = idx(name); return i >= 0 ? (row[i] ?? '').trim() : ''; };

  const rows = lines.slice(1).map((l) => l.split(';'));
  const iLine = rows.find((r) => (r[0] ?? '').trim() === 'I');
  if (!iLine) return null;
  const sLines = rows.filter((r) => (r[0] ?? '').trim() === 'S');

  const issueDate = ymdToIso(col(iLine, 'Invoice Date'));
  if (!issueDate) return null;

  // Kỳ = khoảng Shipment Date của các dòng S; không có thì lùi về ngày xuất.
  const shipDates = sLines.map((r) => ymdToIso(col(r, 'Shipment Date'))).filter(Boolean).sort();
  const periodStart = shipDates[0] ?? issueDate;
  const periodEnd = shipDates[shipDates.length - 1] ?? issueDate;

  const refs = [...new Set(sLines.map((r) => col(r, 'Shipment Reference 1')).filter(Boolean))];
  const shipNos = [...new Set(sLines.map((r) => col(r, 'Shipment Number')).filter(Boolean))];
  const noteParts: string[] = [];
  if (refs.length) noteParts.push(refs.join(', '));
  if (shipNos.length) noteParts.push(`Shipment ${shipNos.join(', ')}`);

  return {
    billNumber: col(iLine, 'Invoice Number'),
    currency: col(iLine, 'Currency'),
    amountInclVat: num(col(iLine, 'Total amount (incl. VAT)')),
    amountExclVat: num(col(iLine, 'Total amount (excl. VAT)')),
    issueDate,
    dueDate: addDaysIso(issueDate, 30),
    periodStart,
    periodEnd,
    note: noteParts.join(' · '),
    shipmentCount: sLines.length,
  };
}
