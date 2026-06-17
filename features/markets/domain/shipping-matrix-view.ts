import type { MarketShipping } from '../types';

export interface RateRow { label: string; price: number; currency: string; }
export interface ZoneView { zoneName: string; countries: string[]; rates: RateRow[]; label?: string }

/** Cận trên (kg) trích từ label "… (a–b kg)" — en-dash U+2013. null nếu không khớp. */
function upperKg(label: string): number | null {
  const m = label.match(/–\s*([\d.]+)\s*kg/);
  return m ? Number(m[1]) : null;
}

/** Phẳng hoá shipping → list zone (giữ thứ tự key), rate sắp theo cận trên kg;
 *  label không khớp đẩy cuối (giữ thứ tự gốc). */
export function flattenShippingMatrix(shipping: MarketShipping | null): ZoneView[] {
  if (!shipping || !shipping.zones) return [];
  return Object.entries(shipping.zones).map(([zoneName, zone]) => {
    const rates: RateRow[] = Object.entries(zone.rates)
      .map(([label, r], i) => ({ label, price: r.price, currency: r.currency, _i: i, _k: upperKg(label) }))
      .sort((a, b) => {
        if (a._k === null && b._k === null) return a._i - b._i;
        if (a._k === null) return 1;
        if (b._k === null) return -1;
        return a._k - b._k;
      })
      .map(({ label, price, currency }) => ({ label, price, currency }));
    return { zoneName, countries: zone.countries ?? [], rates, label: zone.label };
  });
}

export interface MatrixCell { price: number; currency: string; }

/** Tách label "Carrier (a–b kg)" → { carrier, bracket }. Không có "(...)" →
 *  carrier = label, bracket = "—". */
function splitRateLabel(label: string): { carrier: string; bracket: string } {
  const m = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { carrier: label.trim(), bracket: '—' };
  return { carrier: m[1].trim(), bracket: m[2].trim() };
}

/** Viết tắt một market handle: nhiều từ → chữ cái đầu mỗi từ ("middle-east"→"ME",
 *  "south-east-asia"→"SEA"); một từ → 2 chữ đầu ("japan"→"JA"). */
function abbrevMarket(handle: string): string {
  const parts = handle.split(/[^a-z0-9]+/i).filter(Boolean);
  const base = parts.length >= 2 ? parts.map((p) => p[0]).join('') : (parts[0] ?? handle);
  return base.slice(0, 2).toUpperCase();
}

/** Sinh mã market ngắn, DUY NHẤT trong store (mã trùng → thêm số: ME, ME2…).
 *  Ổn định theo thứ tự handle truyền vào. Zone hiển thị là `<mã>-<số thứ tự>`. */
export function buildMarketCodes(handles: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const h of handles) {
    const base = abbrevMarket(h);
    let code = base;
    let n = 2;
    while (used.has(code)) code = `${base}${n++}`;
    used.add(code);
    out[h] = code;
  }
  return out;
}

/** Đổi tên zone của một market sang mã ngắn `<code><n>` (ME1, ME2…), giữ nguyên
 *  countries/rates và thứ tự zone; lưu tên gốc vào `label`. Idempotent: zone đã
 *  có `label` thì giữ label gốc khi chạy lại (chỉ key được chuẩn hoá lại). */
export function applyZoneCodes(shipping: MarketShipping, marketCode: string): MarketShipping {
  const zones: MarketShipping['zones'] = {};
  Object.entries(shipping.zones).forEach(([oldName, zone], i) => {
    zones[`${marketCode}${i + 1}`] = { ...zone, label: zone.label ?? oldName };
  });
  return { zones };
}

/** Phần "carrier-zone" của tên zone gốc — đoạn sau dấu gạch dài (" — "). Không
 *  có gạch → trả nguyên tên. Dùng làm dòng phụ nhỏ dưới mã zone ngắn. */
export function zoneCarrierLabel(zoneName: string): string {
  const parts = zoneName.split(/\s[—–-]\s/);
  return (parts.length > 1 ? parts[parts.length - 1] : zoneName).trim();
}

// Nước lớn / ship nhiều — ưu tiên hiển thị trước ở header cột zone (bảng giá),
// phần còn lại rút gọn thành "… +N" để bảng không quá dài.
const MAJOR_COUNTRIES = new Set([
  'US', 'GB', 'DE', 'FR', 'CA', 'AU', 'JP', 'KR', 'SG', 'HK', 'CN', 'IT', 'ES',
  'NL', 'AE', 'SA', 'TW', 'TH', 'MY', 'PH', 'ID', 'IN', 'NZ', 'MX', 'BR', 'ZA',
  'NG', 'EG', 'SE', 'CH', 'NO', 'DK', 'BE', 'AT', 'IE', 'PL', 'TR', 'IL', 'VN',
]);

/** Rút gọn danh sách nước của 1 zone để hiển thị: ưu tiên nước lớn, tối đa `max`
 *  mã, phần dư trả `extra` (>0). ≤ max → hiện hết. THUẦN. */
export function summarizeZoneCountries(
  codes: string[],
  max = 6,
): { shown: string[]; extra: number } {
  if (codes.length <= max) return { shown: codes, extra: 0 };
  const rank = (c: string) => (MAJOR_COUNTRIES.has(c.toUpperCase()) ? 0 : 1);
  const prioritized = codes.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i);
  return { shown: prioritized.slice(0, max).map((x) => x.c), extra: codes.length - max };
}

export interface ParsedSearch { needle: string; weight: number | null; }

/** Tách query search: "2kg"/"0.5"/"3 KG" → tìm theo cân (highlight dòng);
 *  còn lại → needle chữ thường (lọc cột zone theo tên/nước/market). */
export function parseRateSearch(q: string): ParsedSearch {
  const t = q.trim();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:kg?)?$/i);
  if (m) return { needle: '', weight: Number(m[1]) };
  return { needle: t.toLowerCase(), weight: null };
}

/** Bậc "lo–hi kg" khớp cân nặng w khi lo < w ≤ hi (rơi đúng vào bậc). Bậc
 *  không phải dải → false. */
export function bracketMatchesWeight(bracket: string, weight: number): boolean {
  const m = bracket.match(/([\d.]+)\s*–\s*([\d.]+)\s*kg/);
  if (!m) return false;
  return weight > Number(m[1]) && weight <= Number(m[2]);
}

export interface ZoneWeightMatrix {
  /** Cột — tên zone (giữ thứ tự truyền vào). */
  zoneNames: string[];
  /** Dòng — bậc cân (sắp theo cận trên kg); mỗi ô là giá zone đó hoặc null. */
  rows: Array<{ bracket: string; cells: Array<MatrixCell | null> }>;
}

/** Tập carrier xuất hiện trong các zone (theo thứ tự gặp đầu tiên). Dùng làm tab. */
export function carriersInZones(zones: ZoneView[]): string[] {
  const carriers: string[] = [];
  for (const z of zones) {
    for (const r of z.rates) {
      const { carrier } = splitRateLabel(r.label);
      if (!carriers.includes(carrier)) carriers.push(carrier);
    }
  }
  return carriers;
}

/** Pivot các zone của một market cho MỘT carrier → ma trận rate-card gốc:
 *  cột = zone, dòng = bậc cân (sắp theo cận trên kg), ô = giá. Bậc nào zone
 *  không có → null. Giữ toàn bộ cột zone kể cả khi carrier không có giá nào. */
export function buildZoneWeightMatrix(zones: ZoneView[], carrier: string): ZoneWeightMatrix {
  const zoneNames = zones.map((z) => z.zoneName);
  const order: Array<{ bracket: string; k: number | null; i: number }> = [];
  const seen = new Set<string>();
  const byBracket = new Map<string, Map<string, MatrixCell>>();
  for (const z of zones) {
    for (const r of z.rates) {
      const { carrier: c, bracket } = splitRateLabel(r.label);
      if (c !== carrier) continue;
      if (!seen.has(bracket)) {
        seen.add(bracket);
        order.push({ bracket, k: upperKg(bracket), i: order.length });
        byBracket.set(bracket, new Map());
      }
      byBracket.get(bracket)!.set(z.zoneName, { price: r.price, currency: r.currency });
    }
  }
  order.sort((a, b) => {
    if (a.k === null && b.k === null) return a.i - b.i;
    if (a.k === null) return 1;
    if (b.k === null) return -1;
    return a.k - b.k;
  });
  const rows = order.map(({ bracket }) => ({
    bracket,
    cells: zoneNames.map((zn) => byBracket.get(bracket)!.get(zn) ?? null),
  }));
  return { zoneNames, rows };
}
