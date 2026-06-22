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
  carrierKey: 'fedex' | 'dhl' | null;
  labelDate: Date | null;
  warnings: string[];
}

/** Lark text field: string | number | [{text}] | {text} → string|null. */
function larkText(v: unknown): string | null {
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

function normalizeCourier(raw: string | null): 'fedex' | 'dhl' | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('fedex')) return 'fedex';
  if (s.includes('dhl')) return 'dhl';
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
  const carrierKey = normalizeCourier(cRaw);
  if (cRaw != null && carrierKey === null) warnings.push(`carrier lạ: "${cRaw}"`);

  // date (Lark date = ms epoch number, hoặc string)
  let labelDate: Date | null = null;
  const dRaw = fields['Label Created Date'];
  if (typeof dRaw === 'number' && Number.isFinite(dRaw)) labelDate = new Date(dRaw);
  else {
    const ds = larkText(dRaw);
    if (ds) { const t = Date.parse(ds); if (!Number.isNaN(t)) labelDate = new Date(t); }
  }

  return { orderNumber, logUniqueCode, weightKg, dims, trackingNumber, carrierKey, labelDate, warnings };
}
