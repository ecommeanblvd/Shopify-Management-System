/**
 * THUẦN: 1 record Lark Bitable (object `fields`) → PackRow chuẩn hoá.
 * Field Lark có thể là string, số, hoặc rich array [{text,type}] → đọc cả 3.
 */
export const MAX_WEIGHT_KG = 100;

export interface PackRow {
  orderNumber: string;
  logUniqueCode: string | null;
  weightKg: number | null;
  dims: { l: number; w: number; h: number | null } | null;
  trackingNumber: string | null;
  carrierKey: 'fedex' | 'dhl' | 'aramex' | null;
  labelDate: Date | null;
  warnings: string[];
}

/** Lark text field: string | number | [{text}] | {text} → string|null. */
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
  return null;
}

function parseDims(raw: string | null): PackRow['dims'] {
  if (!raw) return null;
  const parts = raw.toLowerCase().split(/[x×]/).map((p) => Number(p.trim()));
  if (parts.length < 2 || parts.some((n, i) => i < 2 && (!Number.isFinite(n) || n <= 0))) return null;
  const [l, w, h] = parts;
  return { l, w, h: Number.isFinite(h) && h > 0 ? h : null };
}

function normalizeCourier(raw: string | null): 'fedex' | 'dhl' | 'aramex' | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
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
  const carrierKey = normalizeCourier(cRaw);
  if (cRaw != null && carrierKey === null) warnings.push(`carrier lạ: "${cRaw}"`);

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

  return { orderNumber, logUniqueCode, weightKg, dims, trackingNumber, carrierKey, labelDate, warnings };
}
