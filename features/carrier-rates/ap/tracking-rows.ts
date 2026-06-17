import { summariseBill, type BillStatus, type PaymentInput } from './ap-summary';
import { classifyCharge, OTHER_LABEL, VAT_LABEL } from './charge-classify';

/** Một khoản phí chi tiết theo carrier (DHL: code/name/charge/tax/total). */
export interface LineCharge { code: string; name: string; charge: number; tax: number; total: number }

/** Dòng line (đã kèm billId) để dựng bảng theo tracking. */
export interface TrackingLineInput {
  billId: string;
  trackingNumber: string | null;
  orderNumber: string | null;
  weightKg: number | null;
  base: number; discount: number; fuel: number; remote: number;
  demand: number; signature: number; vat: number; other: number; total: number;
  note: string | null;
  /** Breakdown chi tiết; có thì liệt kê đủ thay vì gộp cột. */
  charges?: LineCharge[] | null;
}

export interface TrackingBillInput {
  id: string;
  billNumber: string | null;
  dueDate: string | null;
  amount: number;
}

export interface TrackingFee { label: string; value: number }

export interface TrackingRow {
  key: string;
  billId: string;
  billNumber: string | null;
  dueDate: string | null;
  trackingNumber: string | null;
  orderNumber: string | null;
  weightKg: number | null;
  total: number;
  fees: TrackingFee[];      // khoản phí hiện cột (đã ẩn duty, gộp Khác)
  breakdown: TrackingFee[]; // ĐẦY ĐỦ mọi khoản >0 (gồm duty/thuế) cho dòng mở rộng
  note: string | null;
  status: BillStatus;
  overdue: boolean;
  hasDetail: boolean;    // có gì để mở rộng không
  /** Dòng chỉ gồm thuế/duty nhập khẩu (mọi khoản bị ẩn) → cột phí trống là ĐÚNG,
   *  không phải thiếu dữ liệu. UI gắn nhãn để khỏi nhầm. */
  dutyOnly: boolean;
}

const FEE_LABELS: Array<[keyof TrackingLineInput, string]> = [
  ['base', 'Giá gốc'], ['discount', 'Chiết khấu'], ['fuel', 'Fuel'], ['remote', 'Remote'],
  ['demand', 'Demand'], ['signature', 'Ký nhận'], ['vat', 'VAT'], ['other', 'Khác'],
];

/**
 * Gộp breakdown chi tiết thành các cột cho bảng theo-tracking, để DỄ ĐỐI SOÁT:
 *  - mỗi khoản hiển thị PHÍ NET (đã tách VAT),
 *  - toàn bộ VAT gom vào 1 cột "VAT",
 *  - ẩn thuế/duty ('hide', cả VAT của nó), gộp khoản hiếm vào "Khác" ('other'),
 *    giữ cột riêng cho cước lõi + phụ phí có nghĩa ('keep').
 * Tổng dòng (ln.total) KHÔNG đổi — cột ẩn vẫn nằm trong Tổng.
 */
function foldCharges(charges: LineCharge[]): TrackingFee[] {
  const keep = new Map<string, number>();
  let other = 0;
  let vat = 0;
  for (const c of charges) {
    const label = c.name || c.code;
    const cat = classifyCharge(label);
    if (cat === 'hide') continue;       // ẩn cả phí lẫn VAT của duty/thuế
    vat += c.tax;                        // gom VAT các khoản hiển thị
    if (cat === 'other') { other += c.charge; continue; }  // net
    keep.set(label, (keep.get(label) ?? 0) + c.charge);    // net
  }
  const out: TrackingFee[] = [...keep].map(([label, value]) => ({ label, value }));
  if (other !== 0) out.push({ label: OTHER_LABEL, value: other });
  if (vat !== 0) out.push({ label: VAT_LABEL, value: vat });
  return out.filter((f) => f.value !== 0);
}

/**
 * Dựng bảng "theo tracking": mỗi dòng = 1 bill line (tracking). Hoá đơn không có
 * line nào → 1 dòng tổng (tracking trống). Status/overdue lấy theo HOÁ ĐƠN cha.
 * Thuần, không I/O.
 */
export function buildTrackingRows(
  bills: TrackingBillInput[],
  lines: TrackingLineInput[],
  payments: PaymentInput[],
  today: string,
): TrackingRow[] {
  const paysByBill = new Map<string, PaymentInput[]>();
  for (const p of payments) { const l = paysByBill.get(p.billId) ?? []; l.push(p); paysByBill.set(p.billId, l); }
  const sumByBill = new Map(bills.map((b) =>
    [b.id, summariseBill({ id: b.id, amount: b.amount, currency: '', dueDate: b.dueDate }, paysByBill.get(b.id) ?? [], today)]));
  const linesByBill = new Map<string, TrackingLineInput[]>();
  for (const ln of lines) { const l = linesByBill.get(ln.billId) ?? []; l.push(ln); linesByBill.set(ln.billId, l); }

  const rows: TrackingRow[] = [];
  for (const b of bills) {
    const s = sumByBill.get(b.id)!;
    const bl = linesByBill.get(b.id) ?? [];
    const base = { billId: b.id, billNumber: b.billNumber, dueDate: b.dueDate, status: s.status, overdue: s.overdue };
    if (bl.length === 0) {
      rows.push({ ...base, key: b.id, trackingNumber: null, orderNumber: null, weightKg: null, total: b.amount, fees: [], breakdown: [], note: null, hasDetail: false, dutyOnly: false });
      continue;
    }
    bl.forEach((ln, i) => {
      // Cột bảng (fees): ẩn duty + gộp Khác. Dòng mở rộng (breakdown): ĐẦY ĐỦ.
      const hasCharges = ln.charges && ln.charges.length;
      const fees = hasCharges
        ? foldCharges(ln.charges!)
        : FEE_LABELS.map(([k, label]) => ({ label, value: Number(ln[k] ?? 0) })).filter((f) => f.value !== 0);
      const breakdown = hasCharges
        ? (() => {
            // Đầy đủ MỌI khoản (gồm duty) ở dạng PHÍ NET, + 1 dòng VAT tổng.
            const items = ln.charges!.map((c) => ({ label: c.name || c.code, value: c.charge })).filter((f) => f.value !== 0);
            const vatAll = ln.charges!.reduce((a, c) => a + c.tax, 0);
            if (vatAll !== 0) items.push({ label: VAT_LABEL, value: vatAll });
            return items;
          })()
        : fees;
      // Chỉ-thuế: có breakdown charges nhưng MỌI khoản bị ẩn (duty/tax) → fees rỗng.
      const dutyOnly = !!hasCharges && fees.length === 0 && ln.charges!.every((c) => classifyCharge(c.name || c.code) === 'hide');
      rows.push({
        ...base, key: `${b.id}:${i}`,
        trackingNumber: ln.trackingNumber, orderNumber: ln.orderNumber, weightKg: ln.weightKg,
        total: ln.total, fees, breakdown, note: ln.note, hasDetail: breakdown.length > 0 || !!ln.note,
        dutyOnly,
      });
    });
  }
  return rows;
}
