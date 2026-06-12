import type { MarketShipping } from '../types';

export interface RateRow { label: string; price: number; currency: string; }
export interface ZoneView { zoneName: string; countries: string[]; rates: RateRow[]; }

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
    return { zoneName, countries: zone.countries ?? [], rates };
  });
}

export interface MatrixCell { price: number; currency: string; }
export interface RateMatrix {
  carriers: string[];
  rows: Array<{ bracket: string; cells: Array<MatrixCell | null> }>;
}

/** Tách label "Carrier (a–b kg)" → { carrier, bracket }. Không có "(...)" →
 *  carrier = label, bracket = "—". */
function splitRateLabel(label: string): { carrier: string; bracket: string } {
  const m = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  if (!m) return { carrier: label.trim(), bracket: '—' };
  return { carrier: m[1].trim(), bracket: m[2].trim() };
}

/** Pivot ZoneView → ma trận: cột = carrier (thứ tự xuất hiện đầu), dòng = bậc cân
 *  (giữ thứ tự đã sắp theo cận trên kg trong zone.rates). */
export function buildRateMatrix(zone: ZoneView): RateMatrix {
  const carriers: string[] = [];
  const bracketOrder: string[] = [];
  const byBracket = new Map<string, Map<string, MatrixCell>>();
  for (const r of zone.rates) {
    const { carrier, bracket } = splitRateLabel(r.label);
    if (!carriers.includes(carrier)) carriers.push(carrier);
    if (!byBracket.has(bracket)) { byBracket.set(bracket, new Map()); bracketOrder.push(bracket); }
    byBracket.get(bracket)!.set(carrier, { price: r.price, currency: r.currency });
  }
  const rows = bracketOrder.map((bracket) => ({
    bracket,
    cells: carriers.map((c) => byBracket.get(bracket)!.get(c) ?? null),
  }));
  return { carriers, rows };
}
