/**
 * Parser cho file Excel FedEx Billing Online (FBO export) — 1 dòng/đơn theo
 * AWB, breakdown phụ phí nằm ở các cặp (Nhãn phí, Số tiền) lặp lại (cols 66+).
 * Pure, không I/O — để unit-test. Caller (script/action) lo đọc file + ghi DB.
 */

export type FboBucket =
  | 'base' | 'discount' | 'fuel' | 'demand' | 'remote'
  | 'signature' | 'residential' | 'addressCorrection' | 'importHandling' | 'vat' | 'duty' | 'other';

/** Map nhãn phí FedEx (FBO) → mục của hệ thống. Khớp theo từ khoá, không phụ
 *  thuộc vị trí cột nên không bị silent-drop như LOG-Export tay. */
export function classifyFboCharge(label: string): FboBucket {
  const t = label.toLowerCase();
  // DUTY/customs kiểm TRƯỚC vat: "VAT/Consumption Tax" = thuế tiêu thụ/NK
  // (customs, pass-through người nhập trả) — KHÁC "Vietnam VAT" (VAT cước 8%).
  if (t.includes('consumption') || t.includes('duty') || t.includes('customs') || t.includes('disbursement')) return 'duty';
  /* Thuế tiêu thụ của NƯỚC ĐẾN: Canada HST/GST, QST (Québec), PST. Cùng họ với
   * "VAT/Consumption Tax" đã xếp vào `duty` ở trên — người NHẬP trả, pass-through, không phải
   * VAT trên cước của mình. Quan sát thật: hoá đơn 736062060 (AWB 877737149702, đơn
   * 26-INSLG-SV-0158) có "Canada HST" 172.995 đi cạnh "Duty Disbursement Fee" 225.891; trên
   * bill là MỘT khoản duty-and-tax 398.886, nhưng HST rơi vào `other` nên bảng kê gửi brand
   * tách làm hai dòng, một dòng mang tên "chưa phân loại" (CEO bắt 07/10/2026).
   *
   * So theo TỪ ĐỨNG RIÊNG (`\b`), không phải chuỗi con: "Ghost", "Gstaad" không được tính.
   * Chỉ "Canada HST" là nhãn đã thấy thật; ba cái còn lại thêm theo cùng họ thuế, chưa gặp. */
  if (/\b(hst|gst|qst|pst)\b/.test(t)) return 'duty';
  // VAT cước (Vietnam VAT / UAE Freight VAT / Vietnam VAT Freight).
  if (t.includes('vat')) return 'vat';
  if (t.includes('freight') || t.includes('transportation')) return 'base';
  if (t.includes('discount') || t.includes('automation bonus')) return 'discount';
  if (t.includes('fuel')) return 'fuel';
  if (t.includes('demand')) return 'demand';
  if (t.includes('delivery area')) return 'remote'; // Out of Delivery Area Tier A/B/C
  if (t.includes('pickup area')) return 'remote';   // Out of Pickup Area Tier A/B/C (phía lấy hàng — bắt 21/07)
  if (t.includes('signature')) return 'signature';
  if (t.includes('residential')) return 'residential';
  // Phí FedEx sửa địa chỉ sai (Address Correction) — pass-through hợp lệ khi
  // khách nhập địa chỉ thiếu/sai. Bóc riêng để đối soát không coi là "thu sai".
  if (t.includes('correction')) return 'addressCorrection';
  /* Phí xử lý hàng NHẬP: 'inbound'/'hàng nhập', và 'clearance' — phí thông quan FedEx thu khi
   * làm thủ tục cho hàng vào. Ví dụ thật: hoá đơn 734119505 gom 4 vận đơn hàng TRẢ VỀ Hà Nội
   * (ref `#MBLVD...._R`, đơn gốc đã hoàn tiền), mỗi vận đơn có "Informal Clearance" 250.000.
   *
   * Vì sao `importHandling` chứ không `duty`: VAT trên hoá đơn đó là 32.000 = ĐÚNG 8% ×
   * (Disbursement 150.000 + Informal Clearance 250.000) — VAT đánh trên hai khoản DỊCH VỤ của
   * FedEx, không đánh trên Duty & Tax hay Customs Fee. `duty` là pass-through thuần KHÔNG VAT;
   * `importHandling` là phí xử lý hàng nhập CÓ VAT. Chính phép thử VAT ấy xếp chỗ, không phải
   * tên gọi nghe giống nhau.
   *
   * Đứng SAU phép kiểm duty/customs ở trên nên "Customs Clearance" vẫn về `duty` như cũ. */
  if (t.includes('inbound') || t.includes('hàng nhập') || t.includes('clearance')) return 'importHandling';
  return 'other';
}

/** Các cột billed của shipment_charges dùng để so khi RE-IMPORT (diff). Gồm cột
 *  của CẢ FedEx (importHandling) lẫn DHL (nonConveyable); cột vắng ở payload coi
 *  như 0 nên dùng chung được cho 2 hãng. */
const CHARGE_CMP_KEYS = [
  'totalAmount', 'base', 'fuel', 'remote', 'demand', 'directSignature',
  'residential', 'vat', 'gogreen', 'addressCorrection', 'discount', 'elevatedRisk',
  'importHandling', 'nonConveyable', 'billingWeightKg',
] as const;

/** True khi billed mới GIỐNG hệt dòng shipment_charges cũ (so theo SỐ, vì DB trả
 *  "1890091.00" còn ta ghi "1890091"; cột vắng/null = 0). Dùng để bỏ qua AWB không
 *  đổi khi re-import → không đụng dữ liệu đã đối soát. THUẦN. */
export function fboChargeUnchanged(
  prev: Record<string, unknown>, next: Record<string, unknown>,
): boolean {
  for (const k of CHARGE_CMP_KEYS) {
    if (Number(prev[k] ?? 0) !== Number(next[k] ?? 0)) return false;
  }
  return true;
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
  /**
   * CÂN FedEx CÂN ĐƯỢC, đã quy về KG. Cột FBO "Số tiền theo trọng lượng tính cước"
   * (giá trị là CÂN, không phải tiền) + đơn vị (K=kg, P=lb).
   *
   * ĐÂY KHÔNG PHẢI CÂN TÍNH CƯỚC, dù tên cột trong file FBO nghe như vậy. Ghi chú cũ ở đây
   * viết là "chargeable/billing weight" — ĐO TRÊN DỮ LIỆU THẬT 30/09/2026 thì sai:
   *   - 42 đơn kalisa của 2 kỳ đã phát hành, so cân này với MỐC CÂN của ô bảng giá mà chính
   *     hoá đơn trùng từng đồng: bằng nhau 8, THẤP HƠN 34, cao hơn 0.
   *   - Giá trị rơi lung tung (1,7 · 1,8 · 2,1 · 2,2 · 1,4) chứ không nằm trên bậc 0,5kg.
   *     Cân tính cước thì phải trùng bậc biểu giá.
   * Tức FedEx ghi cân CÂN ĐƯỢC rồi tự làm tròn LÊN bậc để tính tiền; bậc đó không in ra.
   *
   * Muốn biết CÂN TÍNH CƯỚC thì suy ngược từ tiền: cước net của dòng bill trùng đúng một ô
   * biểu giá, mốc cân của ô đó chính là cân FedEx đã tính. KHÔNG suy từ kích thước brand
   * khai — kích thước khai bị thổi lên làm lệch 2/42 đơn (#KLS1994, #KLS2011).
   */
  weightKg: number | null;
  /** POD từ bill: bằng chứng giao hàng chính thức của FedEx (ngày+giờ, người ký). */
  podAt: string | null;   // 'YYYY-MM-DDTHH:mm:00' (giờ địa phương điểm giao)
  podName: string | null;
  base: number; discount: number; fuel: number; demand: number; remote: number;
  signature: number; residential: number; addressCorrection: number; importHandling: number; vat: number;
  duty: number; other: number;
  total: number;
}

const norm = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const META: Record<string, string> = {
  awb: 'số vận đơn hàng không',
  orderRef: 'số tham chiếu của người gửi 1',
  invoiceNumber: 'số hóa đơn fedex',
  invoiceDate: 'ngày lập hóa đơn',
  podDate: 'ngày trong bằng chứng giao hàng',   // 20260707
  podTime: 'thời gian trong bằng chứng giao hàng', // '11:27'
  podName: 'tên trong bằng chứng giao hàng',
  dueDate: 'ngày đáo hạn',
  shipDate: 'ngày vận chuyển (đúng định dạng)',
  service: 'dịch vụ',
  recipientCountry: 'quốc gia/vùng lãnh thổ trong địa chỉ của người nhận',
  recipientStreet1: 'dòng địa chỉ người nhận 1',
  recipientStreet2: 'dòng địa chỉ người nhận 2',
  recipientCity: 'thành phố trong địa chỉ của người nhận',
  recipientState: 'tiểu bang trong địa chỉ của người nhận',
  recipientPostcode: 'mã bưu chính trong địa chỉ của người nhận',
  weight: 'số tiền theo trọng lượng tính cước', // GIÁ TRỊ = cân tính phí (không phải tiền)
  weightUnit: 'đơn vị trọng lượng tính cước',  // K=kg, P=lb
  awbTotal: 'tổng số tiền trong vận đơn hàng không',
};

/** POD FBO: '20260707' + '11:27' → '2026-07-07T11:27:00' (giờ địa phương điểm
 *  giao — đủ cho delivered_at/transit theo NGÀY). Thiếu ngày/sai định dạng → null;
 *  thiếu giờ → 00:00. */
export function parseFboPod(dateStr: string | null, timeStr: string | null): string | null {
  const d = String(dateStr ?? '').trim();
  const m = d.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return null;
  const t = String(timeStr ?? '').trim().match(/^(\d{1,2}):(\d{2})/);
  const hh = t ? t[1].padStart(2, '0') : '00';
  const mm = t ? t[2] : '00';
  return `${m[1]}-${m[2]}-${m[3]}T${hh}:${mm}:00`;
}

/** Quy cân FBO về KG theo đơn vị (P/LB → lb; K/KG → kg). */
export function fboWeightToKg(value: number, unit: string | null): number {
  if (!(value > 0)) return 0;
  const u = String(unit ?? '').trim().toUpperCase();
  if (u === 'P' || u === 'LB' || u === 'LBS') return Math.round(value * 0.453592 * 1000) / 1000;
  return value; // K / KG / rỗng → coi là kg
}

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
    weightKg: cols.meta.weight >= 0 && row[cols.meta.weight] != null
      ? fboWeightToKg(parseFboAmount(row[cols.meta.weight]), str(row, cols.meta.weightUnit)) || null
      : null,
    podAt: parseFboPod(str(row, cols.meta.podDate), str(row, cols.meta.podTime)),
    podName: str(row, cols.meta.podName),
    base: 0, discount: 0, fuel: 0, demand: 0, remote: 0, signature: 0,
    residential: 0, addressCorrection: 0, importHandling: 0, vat: 0, duty: 0, other: 0, total: 0,
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
    + r.signature + r.residential + r.addressCorrection + r.importHandling + r.vat + r.duty + r.other);
  return r;
}

const SUM_KEYS = ['base', 'discount', 'fuel', 'demand', 'remote', 'signature',
  'residential', 'addressCorrection', 'importHandling', 'vat', 'duty', 'other', 'total'] as const;

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
