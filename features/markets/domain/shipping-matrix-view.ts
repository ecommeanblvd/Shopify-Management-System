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
