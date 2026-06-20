/**
 * Đọc tổng tiền + ngày từ text PDF hoá đơn (pdftotext -layout) theo carrier.
 * Map số hoá đơn → {total, issueDate, dueDate}. Block thiếu total → BỎ (không
 * emit total:0). THUẦN — không I/O. Layout lấy từ mẫu thật FedEx/DHL.
 */
export interface PdfInvoiceTotals { total: number; issueDate: string | null; dueDate: string | null }

const EN_MONTHS: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};
const numFrom = (s: string): number => Number(s.replace(/,/g, ''));
/** "28 Jul 2025" → "2025-07-28" */
function enDateToIso(s: string): string | null {
  const m = s.match(/^(\d{1,2}) (\w{3}) (\d{4})$/);
  if (!m) return null;
  const mm = EN_MONTHS[m[2]];
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null;
}
/** "13/05/2026" → "2026-05-13" */
function dmyToIso(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Cắt text thành đoạn theo từng mỏ neo (vị trí số HĐ); đoạn i = [idx_i, idx_{i+1}). */
function segmentsByAnchor(text: string, re: RegExp): { num: string; seg: string }[] {
  const marks: { num: string; idx: number }[] = [];
  let m: RegExpExecArray | null;
  const g = new RegExp(re.source, 'g');
  while ((m = g.exec(text)) !== null) marks.push({ num: m[1], idx: m.index });
  return marks.map((mk, i) => ({
    num: mk.num,
    seg: text.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : undefined),
  }));
}

function parseFedex(text: string): Record<string, PdfInvoiceTotals> {
  const out: Record<string, PdfInvoiceTotals> = {};
  for (const { num, seg } of segmentsByAnchor(text, /Invoice No\.:\s+(\d{6,})/)) {
    const total = seg.match(/Grand Total \(VAT included\)\s+([\d,]+)/);
    if (!total) continue; // không có tổng trong block → bỏ
    const issue = seg.match(/Invoice Date:\s+(\d{1,2} \w{3} \d{4})/);
    const due = seg.match(/due by (\d{1,2} \w{3} \d{4})/);
    out[num] = { total: numFrom(total[1]), issueDate: issue ? enDateToIso(issue[1]) : null, dueDate: due ? enDateToIso(due[1]) : null };
  }
  return out;
}

function parseDhl(text: string): Record<string, PdfInvoiceTotals> {
  const out: Record<string, PdfInvoiceTotals> = {};
  for (const { num, seg } of segmentsByAnchor(text, /Invoice no\.\s+(HANR\d+)/)) {
    const total = seg.match(/Total VND\s+([\d,]+)/);
    if (!total) continue;
    const date = seg.match(/\bDate\s+(\d{2}\/\d{2}\/\d{4})/);
    out[num] = { total: numFrom(total[1]), issueDate: date ? dmyToIso(date[1]) : null, dueDate: null };
  }
  return out;
}

export function parsePdfInvoiceTotals(text: string, carrier: 'fedex' | 'dhl'): Record<string, PdfInvoiceTotals> {
  return carrier === 'fedex' ? parseFedex(text) : parseDhl(text);
}
