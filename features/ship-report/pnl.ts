/**
 * THUẦN: P&L mảng ship — gộp đơn Shopify + ship hộ theo tháng / carrier / quốc gia.
 *   Thu: Shopify = phí ship khách trả SAU giảm (quy VND); Ship hộ = giá thu thực
 *        (actualCharged ?? charged).
 *   Chi: Shopify = billed từ bill carrier; Ship hộ = cước bill thực ?? dự tính.
 * billedPct cho biết bao nhiêu % đơn đã có bill (phần còn lại chi phí dự tính/thiếu).
 */

export interface ShipPnlItem {
  month: string; // 'YYYY-MM' theo ngày ship (label/ship date)
  segment: 'shopify' | 'ship_ho';
  carrierKey: string | null;
  country: string | null;
  revenueVnd: number | null;
  costVnd: number | null;
  billed: boolean;
}

export interface PnlRow {
  month: string;
  segment: 'shopify' | 'ship_ho' | 'total';
  orders: number;
  revenueVnd: number;
  costVnd: number;
  marginVnd: number;
  /** margin / revenue; null khi revenue = 0. */
  marginPct: number | null;
  /** % đơn có chi phí từ bill thực. */
  billedPct: number;
}

const pct = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

function rowOf(month: string, segment: PnlRow['segment'], items: ShipPnlItem[]): PnlRow {
  const revenueVnd = items.reduce((s, i) => s + (i.revenueVnd ?? 0), 0);
  const costVnd = items.reduce((s, i) => s + (i.costVnd ?? 0), 0);
  const billed = items.filter((i) => i.billed).length;
  const marginVnd = revenueVnd - costVnd;
  return {
    month, segment, orders: items.length, revenueVnd, costVnd, marginVnd,
    marginPct: pct(marginVnd, revenueVnd),
    billedPct: items.length > 0 ? Math.round((billed / items.length) * 1000) / 10 : 0,
  };
}

/** Theo tháng: 1 dòng total + 1 dòng mỗi segment có đơn. Tháng mới nhất trước. */
export function pnlByMonth(items: ShipPnlItem[]): PnlRow[] {
  const byMonth = new Map<string, ShipPnlItem[]>();
  for (const i of items) {
    const arr = byMonth.get(i.month) ?? [];
    arr.push(i);
    byMonth.set(i.month, arr);
  }
  const out: PnlRow[] = [];
  for (const month of [...byMonth.keys()].sort().reverse()) {
    const list = byMonth.get(month)!;
    out.push(rowOf(month, 'total', list));
    for (const seg of ['shopify', 'ship_ho'] as const) {
      const sub = list.filter((i) => i.segment === seg);
      if (sub.length > 0) out.push(rowOf(month, seg, sub));
    }
  }
  return out;
}

export interface PnlBreakdownRow {
  carrierKey: string;
  country: string;
  orders: number;
  revenueVnd: number;
  costVnd: number;
  marginVnd: number;
  marginPct: number | null;
}

/** Breakdown carrier × quốc gia cho 1 tháng (hoặc mọi tháng khi month=null), sort đơn giảm dần. */
export function pnlBreakdown(items: ShipPnlItem[], month: string | null): PnlBreakdownRow[] {
  const scoped = month == null ? items : items.filter((i) => i.month === month);
  const map = new Map<string, ShipPnlItem[]>();
  for (const i of scoped) {
    const key = `${i.carrierKey ?? '—'}|${i.country ?? '—'}`;
    const arr = map.get(key) ?? [];
    arr.push(i);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const [carrierKey, country] = key.split('|');
      const revenueVnd = list.reduce((s, i) => s + (i.revenueVnd ?? 0), 0);
      const costVnd = list.reduce((s, i) => s + (i.costVnd ?? 0), 0);
      const marginVnd = revenueVnd - costVnd;
      return { carrierKey, country, orders: list.length, revenueVnd, costVnd, marginVnd, marginPct: pct(marginVnd, revenueVnd) };
    })
    .sort((a, b) => b.orders - a.orders);
}
