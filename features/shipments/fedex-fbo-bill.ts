/**
 * Gom các dòng FBO (1/AWB) thành hoá đơn AP: nhóm theo Số hoá đơn FedEx →
 * 1 carrier_bill + N carrier_bill_lines. Pure, không I/O — để unit-test.
 *
 * AP = số PHẢI TRẢ FedEx → amount/line.total GỒM duty (thuế NCC ứng trước).
 * (Đối soát billed thì loại duty — xem fboShippingTotal ở fedex-fbo-parse.)
 */
import type { FboBilledRow } from './fedex-fbo-parse';

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "17-Jun-2025" → "2025-06-17". Chấp nhận sẵn ISO. Sai/rỗng → null. */
export function parseFboDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  return `${m[3]}-${mon}-${m[1].padStart(2, '0')}`;
}

/** 1 dòng vận đơn trên hoá đơn AP (gồm duty). Map khớp cột carrier_bill_lines. */
export interface FboApLine {
  awb: string;
  orderRef: string | null;
  weightKg: number | null;
  podAt: string | null;
  podName: string | null;
  base: number; discount: number; fuel: number; remote: number; demand: number;
  signature: number; vat: number; other: number; total: number;
}

/** Gộp 1 FboBilledRow → dòng AP: residential→signature, (importHandling+duty)
 *  →other; total = tổng FBO (gồm duty). Bảo toàn: Σ thành phần = total. */
export function fboApLine(r: FboBilledRow): FboApLine {
  return {
    awb: r.awb,
    orderRef: r.orderRef,
    weightKg: r.weightKg,
    podAt: r.podAt, podName: r.podName,
    base: r.base, discount: r.discount, fuel: r.fuel, remote: r.remote, demand: r.demand,
    signature: r.signature + r.residential,
    vat: r.vat,
    other: r.other + r.importHandling + r.duty,
    total: r.total,
  };
}

/** Tổng cước SHIPPING (LOẠI duty hải quan pass-through) — dùng cho đối soát
 *  billed (shipment_charges). AP thì gồm duty; đối soát thì không. */
export function fboShippingTotal(r: FboBilledRow): number {
  return r.base + r.discount + r.fuel + r.demand + r.remote
    + r.signature + r.residential + r.addressCorrection + r.importHandling + r.vat + r.other;
}

export interface FboBill {
  /** Số hoá đơn FedEx (null nếu dòng không có số). */
  billNumber: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  issueDate: string | null;
  dueDate: string | null;
  /** Σ total (gồm duty) — số phải trả FedEx cho hoá đơn này. */
  amount: number;
  lines: FboApLine[];
}

const minDate = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : a < b ? a : b;
const maxDate = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : a > b ? a : b;

/** Nhóm dòng FBO theo số hoá đơn → danh sách hoá đơn AP. */
export function groupFboIntoBills(rows: FboBilledRow[]): FboBill[] {
  const byNum = new Map<string, FboBill>();
  for (const r of rows) {
    const key = r.invoiceNumber ?? '∅';
    const ship = parseFboDate(r.shipDate);
    let bill = byNum.get(key);
    if (!bill) {
      bill = {
        billNumber: r.invoiceNumber,
        periodStart: ship, periodEnd: ship,
        issueDate: parseFboDate(r.invoiceDate),
        dueDate: parseFboDate(r.dueDate),
        amount: 0, lines: [],
      };
      byNum.set(key, bill);
    }
    bill.periodStart = minDate(bill.periodStart, ship);
    bill.periodEnd = maxDate(bill.periodEnd, ship);
    bill.issueDate = bill.issueDate ?? parseFboDate(r.invoiceDate);
    bill.dueDate = bill.dueDate ?? parseFboDate(r.dueDate);
    bill.amount += r.total;
    bill.lines.push(fboApLine(r));
  }
  return [...byNum.values()];
}
