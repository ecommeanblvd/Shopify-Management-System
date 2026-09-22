/**
 * THUẦN: 1 record Lark Bitable (object `fields`) → PackRow chuẩn hoá.
 * Field Lark có thể là string, số, hoặc rich array [{text,type}] → đọc cả 3.
 */
import { hangTheoMaVanDon } from '@/lib/ma-van-don';

export const MAX_WEIGHT_KG = 100;

export interface PackRow {
  orderNumber: string;
  logUniqueCode: string | null;
  weightKg: number | null;
  dims: { l: number; w: number; h: number | null } | null;
  trackingNumber: string | null;
  carrierKey: HangPack | null;
  labelDate: Date | null;
  /** Kho xuất (cột Lark "Base"): SG | HN. Màn Đóng hàng nhóm theo ngày rồi tới base, giống view Lark. */
  base: string | null;
  /** Ngày Lark đang ghi ở "Label Created Date", GIỮ cả ngày tương lai (kiện hold sang ngày khác). */
  ngayDiDuKien: Date | null;
  hop: string | null;
  /** Mã record kho mà cột "Select VTĐG1" trỏ tới — tra tên hộp qua getTenHopVtdg. */
  hopRecordId: string | null;
  skuText: string | null;
  pieces: number | null;
  warnings: string[];
}

/** Lark text field: string | number | [{text}] | {text} | {type,value} → string|null.
 *  Shape {type, value} là cột lookup/formula (Lark đổi kiểu cột "Final | Delivery
 *  Status" ~25/06 làm parser trả null hàng loạt → mất delivery status) — unwrap
 *  đệ quy vào `value`. */
export function larkText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) {
    const s = v.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text ?? '') : '')).join('').trim();
    return s || null;
  }
  if (typeof v === 'object' && 'text' in (v as object)) {
    const s = String((v as { text: unknown }).text ?? '').trim();
    return s || null;
  }
  if (typeof v === 'object' && 'value' in (v as object)) {
    return larkText((v as { value: unknown }).value);
  }
  return null;
}

function parseDims(raw: string | null): PackRow['dims'] {
  if (!raw) return null;
  const parts = raw.toLowerCase().split(/[x×]/).map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n, i) => i < 2 && (!Number.isFinite(n) || n <= 0))) return null;
  const [l, w, h] = parts;
  return { l, w, h: Number.isFinite(h) && h > 0 ? h : null };
}

export type HangPack = 'fedex' | 'dhl' | 'aramex' | 'ups';

/** Hãng nhận ra chắc chắn từ dạng mã vận đơn — thắng cột Couriers vì cột này hay chọn nhầm
 *  (CEO 17/09: mã 1Z… đang bị ghi FedEx). Luật ở lib/ma-van-don.ts, dùng chung với ship hộ. */
export { hangTheoMaVanDon } from '@/lib/ma-van-don';

function normalizeCourier(raw: string | null): HangPack | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('ups')) return 'ups';
  if (s.includes('fedex')) return 'fedex';
  if (s.includes('dhl')) return 'dhl';
  if (s.includes('aramex')) return 'aramex';
  return null;
}

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
/** Epoch (nửa đêm giờ VN) → Date có UTC = nửa đêm NGÀY-LỊCH VN, để khi lưu vào
 *  cột timestamp không-tz ra "giờ-treo VN" (vd 2026-06-08 00:00:00), khớp mốc
 *  fuel/rate-card. Floor về ngày nên chịu được epoch có cả giờ. */
export function larkEpochToVnMidnight(ms: number): Date {
  const vn = new Date(ms + VN_OFFSET_MS);
  return new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate()));
}

/** Nửa đêm NGÀY-LỊCH-VN của HÔM NAY, biểu diễn dạng UTC-treo (khớp cách lưu ngày). */
function todayVnMidnightUtc(): number {
  const vn = new Date(Date.now() + VN_OFFSET_MS);
  return Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate());
}

// Ngày Lark hợp lệ >= mốc này. Epoch Lark hỏng hay ra ngày vô lý (vd 1997) —
// loại tại nguồn để không rơi vào label/ngày giao.
const MIN_PLAUSIBLE_MS = Date.UTC(2020, 0, 1);
/** null nếu ngày quá cũ (rác); ngược lại giữ nguyên. Dùng cho mọi ngày đọc từ Lark. */
export function plausibleLarkDate(d: Date | null): Date | null {
  if (!d) return null;
  return d.getTime() >= MIN_PLAUSIBLE_MS ? d : null;
}

// Mốc THỰC TẾ (label đã tạo, hàng đã giao) không thể ở tương lai. Ops gõ nhầm
// năm trên Lark (vd 30/12/2026 khi mới tháng 7) → TA2113 từng dính shipped_at
// tương lai. Chừa 48h slack cho lệch múi giờ/nhập sớm biên ngày.
const FUTURE_SLACK_MS = 48 * 60 * 60 * 1000;
/** null nếu ngày rác HOẶC ở tương lai (quá 48h) — dùng cho mốc thực tế đã xảy ra.
 *  Ngày DỰ KIẾN (được phép tương lai) vẫn dùng plausibleLarkDate. */
export function plausiblePastLarkDate(d: Date | null, now: Date = new Date()): Date | null {
  const p = plausibleLarkDate(d);
  if (!p) return null;
  return p.getTime() <= now.getTime() + FUTURE_SLACK_MS ? p : null;
}

/** THUẦN: nhiều đoạn rich-text của một ô Lark → nối bằng ", ".
 *  larkText nối liền không dấu, nên 2 SKU trong một kiện dính thành một chuỗi khó đọc. */
export function larkDanhSach(v: unknown): string | null {
  if (Array.isArray(v)) {
    const ds = v.map((x) => (x && typeof x === 'object' && 'text' in x ? String((x as { text: unknown }).text ?? '').trim() : '')).filter(Boolean);
    return ds.length ? [...new Set(ds)].join(', ') : null;
  }
  return larkText(v);
}

/** THUẦN: tên hộp bỏ đuôi định danh kho ("…-VTĐG1-WH-8870") cho dễ đọc. */
export function tenHopGon(s: string | null): string | null {
  if (!s) return null;
  const g = s.replace(/-VT[ĐD]G\d*-WH-\d+$/i, '').replace(/-VT[ĐD]G\d*$/i, '').trim();
  return g || null;
}

/** THUẦN: mã record đầu tiên của một cột liên kết Lark ({link_record_ids} hoặc mảng chuỗi). */
export function maLienKetDauTien(v: unknown): string | null {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null;
  if (v && typeof v === 'object') {
    const ids = (v as { link_record_ids?: unknown }).link_record_ids;
    if (Array.isArray(ids) && typeof ids[0] === 'string') return ids[0];
  }
  return null;
}

export function parsePackRow(fields: Record<string, unknown>): PackRow {
  const warnings: string[] = [];
  const orderNumber = larkText(fields['Order Number']) ?? '';
  const logUniqueCode = larkText(fields['Log Unique code']);
  const trackingNumber = larkText(fields['Tracking Number']);

  // weight
  let weightKg: number | null = null;
  const wRaw = larkText(fields['Weights']);
  if (wRaw != null) {
    const w = Number(wRaw);
    if (!Number.isFinite(w) || w <= 0 || w > MAX_WEIGHT_KG) {
      warnings.push(`cân bất thường: "${wRaw}"`);
    } else {
      weightKg = w;
    }
  }

  const dims = parseDims(larkText(fields['Dimension ( điền tay)']));

  // carrier
  const cRaw = larkText(fields['Couriers']);
  const theoCot = normalizeCourier(cRaw);
  if (cRaw != null && theoCot === null) warnings.push(`carrier lạ: "${cRaw}"`);

  // Ngày Lark = epoch (ms, UTC) của NỬA ĐÊM GIỜ VN. Phần còn lại của hệ thống
  // (mốc fuel, rate-card, import cũ) lưu ngày dạng "giờ-treo VN" vào cột timestamp
  // không-tz (vd 2026-06-08 00:00:00). Nếu lưu thẳng epoch thì thành 2026-06-07
  // 17:00:00 (UTC) → lệch 7h, đơn ship đúng ngày đầu tuần fuel bị tính sang tuần
  // trước. → đổi epoch sang nửa-đêm-ngày-lịch-VN trước khi lưu.
  let labelDate: Date | null = null;
  const dRaw = fields['Label Created Date'];
  if (typeof dRaw === 'number' && Number.isFinite(dRaw)) labelDate = larkEpochToVnMidnight(dRaw);
  else {
    const ds = larkText(dRaw);
    if (ds) { const t = Date.parse(ds); if (!Number.isNaN(t)) labelDate = larkEpochToVnMidnight(t); }
  }

  // Ngày Lark đang ghi, chỉ loại rác quá cũ: hold sang ngày mai là NGÀY ĐI DỰ KIẾN hợp lệ,
  // màn Đóng hàng phải bám theo nó (CEO 22/09/2026).
  const ngayDiDuKien = plausibleLarkDate(labelDate);

  // Loại ngày quá cũ (epoch hỏng → 1997…) VÀ ngày tương lai (ops gõ nhầm năm /
  // placeholder cho đơn chưa ship): label là mốc ĐÃ xảy ra, không thể ở tương lai.
  const labelPlausible = plausibleLarkDate(labelDate);
  labelDate = plausiblePastLarkDate(labelDate);
  if (labelPlausible && !labelDate) warnings.push(`label date ở tương lai, bỏ qua: ${labelPlausible.toISOString().slice(0, 10)}`);
  // Một label KHÔNG THỂ được tạo ở NGÀY LỊCH TƯƠNG LAI (theo lịch VN). Lark hay
  // điền placeholder ("31/12/2026", hoặc ngày mai) ở cột "Label Created Date" cho
  // đơn CHƯA ship → nếu để lọt, reconcile lấy nó làm NGÀY SHIP → hiện ngày ship
  // rác + chọn sai rate-card/fuel. So theo ngày-lịch-VN (labelDate lưu dạng
  // nửa-đêm-VN-treo-UTC) nên bền vững bất kể giờ chạy. → đơn chưa ship có
  // labelDate=null; reconcile fallback về ngày đặt / báo "chưa ship".
  if (labelDate && labelDate.getTime() > todayVnMidnightUtc()) {
    warnings.push(`Label Created Date ở tương lai (${labelDate.toISOString().slice(0, 10)}) → bỏ (đơn chưa ship?)`);
    labelDate = null;
  }

  const theoMa = hangTheoMaVanDon(trackingNumber);
  if (theoMa && theoCot && theoMa !== theoCot) warnings.push(`Couriers ghi "${cRaw}" nhưng mã ${trackingNumber} là ${theoMa.toUpperCase()}`);
  const carrierKey = theoMa ?? theoCot;

  // Hộp đóng gói / SKU / số món — màn "Đóng hàng" (spec 22/09) cần để Đức nhìn
  // kiện mà không mở Lark. Lark select trả string; số món có thể là số hoặc text.
  const baseRaw = larkText(fields['Base']);
  const base = baseRaw ? baseRaw.trim().toUpperCase() : null;
  // "Select VTĐG1" là cột LIÊN KẾT: Lark trả {link_record_ids:[...]}, không có tên hộp.
  const hop = larkText(fields['Select VTĐG1']);
  const hopRecordId = maLienKetDauTien(fields['Select VTĐG1']);
  const skuText = larkDanhSach(fields['SKU(s)']);
  const piecesRaw = larkText(fields['Total pieces per pack']);
  const piecesNum = piecesRaw != null ? Number(piecesRaw) : NaN;
  const pieces = Number.isInteger(piecesNum) && piecesNum > 0 ? piecesNum : null;
  return { orderNumber, logUniqueCode, weightKg, dims, trackingNumber, carrierKey, labelDate, base, ngayDiDuKien, hop, hopRecordId, skuText, pieces, warnings };
}
