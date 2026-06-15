/**
 * Parser cho file Excel FedEx Billing Online (FBO export) — 1 dòng/đơn theo
 * AWB, breakdown phụ phí nằm ở các cặp (Nhãn phí, Số tiền) lặp lại (cols 66+).
 * Pure, không I/O — để unit-test. Caller (script/action) lo đọc file + ghi DB.
 */

export type FboBucket =
  | 'base' | 'discount' | 'fuel' | 'demand' | 'remote'
  | 'signature' | 'residential' | 'importHandling' | 'vat' | 'duty' | 'other';

/** Map nhãn phí FedEx (FBO) → mục của hệ thống. Khớp theo từ khoá, không phụ
 *  thuộc vị trí cột nên không bị silent-drop như LOG-Export tay. */
export function classifyFboCharge(label: string): FboBucket {
  const t = label.toLowerCase();
  // DUTY/customs kiểm TRƯỚC vat: "VAT/Consumption Tax" = thuế tiêu thụ/NK
  // (customs, pass-through người nhập trả) — KHÁC "Vietnam VAT" (VAT cước 8%).
  if (t.includes('consumption') || t.includes('duty') || t.includes('customs') || t.includes('disbursement')) return 'duty';
  // VAT cước (Vietnam VAT / UAE Freight VAT / Vietnam VAT Freight).
  if (t.includes('vat')) return 'vat';
  if (t.includes('freight') || t.includes('transportation')) return 'base';
  if (t.includes('discount') || t.includes('automation bonus')) return 'discount';
  if (t.includes('fuel')) return 'fuel';
  if (t.includes('demand')) return 'demand';
  if (t.includes('delivery area')) return 'remote'; // Out of Delivery Area Tier A/B/C
  if (t.includes('signature')) return 'signature';
  if (t.includes('residential')) return 'residential';
  if (t.includes('inbound') || t.includes('hàng nhập')) return 'importHandling';
  return 'other';
}

/** "1,371,600.00" / "-672,084.00" → number. Rỗng/không hợp lệ → 0. */
export function parseFboAmount(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

export interface FboBilledRow {
  awb: string;
  orderRef: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  shipDate: string | null;
  service: string | null;
  recipientCountry: string | null;
  /** Địa chỉ người nhận (để classify residential qua FedEx Address API). */
  recipientStreet1: string | null;
  recipientStreet2: string | null;
  recipientCity: string | null;
  recipientState: string | null;
  recipientPostcode: string | null;
  weightKg: number | null;
  base: number; discount: number; fuel: number; demand: number; remote: number;
  signature: number; residential: number; importHandling: number; vat: number;
  duty: number; other: number;
  total: number;
}

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const META: Record<string, string> = {
  awb: 'số vận đơn hàng không',
  orderRef: 'số tham chiếu của người gửi 1',
  invoiceNumber: 'số hóa đơn fedex',
  invoiceDate: 'ngày lập hóa đơn',
  dueDate: 'ngày đáo hạn',
  shipDate: 'ngày vận chuyển (đúng định dạng)',
  service: 'dịch vụ',
  recipientCountry: 'quốc gia/vùng lãnh thổ trong địa chỉ của người nhận',
  recipientStreet1: 'dòng địa chỉ người nhận 1',
  recipientStreet2: 'dòng địa chỉ người nhận 2',
  recipientCity: 'thành phố trong địa chỉ của người nhận',
  recipientState: 'tiểu bang trong địa chỉ của người nhận',
  recipientPostcode: 'mã bưu chính trong địa chỉ của người nhận',
  weight: 'trọng lượng tính phí', // có thể vắng — fallback bên dưới
  awbTotal: 'tổng số tiền trong vận đơn hàng không',
};

const CHARGE_LABEL_HEADER = 'nhãn phí trên vận đơn hàng không';

export interface FboColumns {
  meta: Record<string, number>;
  /** Index cột Nhãn phí; số tiền ở index+1. */
  chargeLabelCols: number[];
}

/** Định vị cột theo TÊN header (metadata) + các cặp nhãn/số tiền (theo vị trí). */
export function resolveFboColumns(header: ReadonlyArray<unknown>): FboColumns {
  const byName = new Map<string, number>();
  header.forEach((c, i) => { const k = norm(c); if (k && !byName.has(k)) byName.set(k, i); });
  const meta: Record<string, number> = {};
  for (const [key, name] of Object.entries(META)) meta[key] = byName.get(name) ?? -1;
  const chargeLabelCols: number[] = [];
  header.forEach((c, i) => { if (norm(c) === CHARGE_LABEL_HEADER) chargeLabelCols.push(i); });
  return { meta, chargeLabelCols };
}

const str = (row: ReadonlyArray<unknown>, i: number): string | null => {
  if (i < 0) return null; const v = String(row[i] ?? '').trim(); return v || null;
};

/** Parse 1 dòng dữ liệu FBO → breakdown đã phân loại. NULL khi không có AWB. */
export function parseFboRow(row: ReadonlyArray<unknown>, cols: FboColumns): FboBilledRow | null {
  const awb = str(row, cols.meta.awb);
  if (!awb) return null;
  const r: FboBilledRow = {
    awb,
    orderRef: str(row, cols.meta.orderRef),
    invoiceNumber: str(row, cols.meta.invoiceNumber),
    invoiceDate: str(row, cols.meta.invoiceDate),
    dueDate: str(row, cols.meta.dueDate),
    shipDate: str(row, cols.meta.shipDate),
    service: str(row, cols.meta.service),
    recipientCountry: str(row, cols.meta.recipientCountry),
    recipientStreet1: str(row, cols.meta.recipientStreet1),
    recipientStreet2: str(row, cols.meta.recipientStreet2),
    recipientCity: str(row, cols.meta.recipientCity),
    recipientState: str(row, cols.meta.recipientState),
    recipientPostcode: str(row, cols.meta.recipientPostcode),
    weightKg: cols.meta.weight >= 0 && row[cols.meta.weight] != null ? parseFboAmount(row[cols.meta.weight]) : null,
    base: 0, discount: 0, fuel: 0, demand: 0, remote: 0, signature: 0,
    residential: 0, importHandling: 0, vat: 0, duty: 0, other: 0, total: 0,
  };
  for (const c of cols.chargeLabelCols) {
    const label = String(row[c] ?? '').trim();
    if (!label) continue;
    const amount = parseFboAmount(row[c + 1]);
    r[classifyFboCharge(label)] += amount;
  }
  const awbTotal = cols.meta.awbTotal >= 0 ? parseFboAmount(row[cols.meta.awbTotal]) : 0;
  // Tổng: ưu tiên cột "Tổng số tiền trong vận đơn"; rỗng → cộng các mục.
  r.total = awbTotal || (r.base + r.discount + r.fuel + r.demand + r.remote
    + r.signature + r.residential + r.importHandling + r.vat + r.duty + r.other);
  return r;
}

const SUM_KEYS = ['base', 'discount', 'fuel', 'demand', 'remote', 'signature',
  'residential', 'importHandling', 'vat', 'duty', 'other', 'total'] as const;

/** Hợp nhất các dòng FBO cùng AWB cho ĐỐI SOÁT CƯỚC: 1 AWB có thể có 2 dòng —
 *  dòng CƯỚC (duty=0) và dòng THUẾ/HẢI QUAN (duty>0, customs pass-through người
 *  nhập trả). Chỉ lấy dòng cước (gộp nếu nhiều), BỎ dòng thuế thuần — để dòng
 *  thuế không ghi đè dòng cước (gốc của delta khổng lồ trước đây). */
export function consolidateFboShipping(rows: FboBilledRow[]): FboBilledRow[] {
  const byAwb = new Map<string, FboBilledRow[]>();
  for (const r of rows) { const a = byAwb.get(r.awb); if (a) a.push(r); else byAwb.set(r.awb, [r]); }
  const out: FboBilledRow[] = [];
  for (const group of byAwb.values()) {
    const shipping = group.filter((r) => r.duty === 0); // dòng cước
    if (shipping.length === 0) continue; // chỉ có dòng thuế/hải quan → bỏ
    if (shipping.length === 1) { out.push(shipping[0]); continue; }
    const merged: FboBilledRow = { ...shipping[0] };
    for (const r of shipping.slice(1)) for (const k of SUM_KEYS) merged[k] += r[k];
    out.push(merged);
  }
  return out;
}

/** Parse toàn bộ sheet (rows[0]=header). Bỏ dòng không có AWB. */
export function parseFedexFbo(rows: ReadonlyArray<ReadonlyArray<unknown>>): FboBilledRow[] {
  if (rows.length < 2) return [];
  const cols = resolveFboColumns(rows[0]);
  const out: FboBilledRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const r = parseFboRow(rows[i], cols);
    if (r) out.push(r);
  }
  return out;
}
