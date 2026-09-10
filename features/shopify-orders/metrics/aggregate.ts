import type { OrderMetrics } from './compute';

export interface AggregateMetrics {
  orderCount: number;
  currency: string;
  /** Σ line-items only — Subtotal across orders. */
  subtotal: number;
  /** Σ true GMV = Σ (subtotal + shippingRevenue). */
  gmv: number;
  refundedAmount: number;
  netGmv: number;
  /** Σ khách thực trả = Σ (gmv − discount − refund). Mẫu số Margin %. */
  netSales: number;
  discount: number;
  shippingRevenue: number;
  shippingCost: number;
  skuCost: number;
  /** Σ Margin SP = Σ (net sales hàng − SKU cost). */
  marginSp: number;
  tax: number;
  /** Σ revenue MỌI đơn — đơn thiếu COGS đóng góp số dương giả; chỉ để tương thích, KPI hiện `revenueDuCogs`. */
  revenue: number;
  /** Margin % = revenueDuCogs / netSalesDuCogs — chỉ trên đơn ĐỦ giá vốn (CEO 10/09/2026). 0 khi không có đơn nào đủ. */
  margin: number;
  skuCostCoverage: number;
  /** Đơn đủ giá vốn mọi dòng (thực hoặc dự tính) và phần chưa tính được. */
  soDonDuCogs: number;
  revenueDuCogs: number;
  netSalesDuCogs: number;
  soDonThieuCogs: number;
  netSalesThieuCogs: number;
}

export function aggregateMetrics(orders: readonly OrderMetrics[]): AggregateMetrics {
  if (orders.length === 0) {
    return {
      orderCount: 0, currency: '',
      subtotal: 0, gmv: 0, refundedAmount: 0, netGmv: 0, netSales: 0, discount: 0,
      shippingRevenue: 0, shippingCost: 0, skuCost: 0, marginSp: 0, tax: 0,
      revenue: 0, margin: 0, skuCostCoverage: 0,
      soDonDuCogs: 0, revenueDuCogs: 0, netSalesDuCogs: 0, soDonThieuCogs: 0, netSalesThieuCogs: 0,
    };
  }
  const sum = (k: keyof OrderMetrics) => orders.reduce((s, o) => s + (o[k] as number), 0);
  const gmv = sum('gmv');
  const netGmv = sum('netGmv');
  const netSales = sum('netSales');
  const revenue = sum('revenue');
  const du = orders.filter((o) => o.duCogs); const thieu = orders.filter((o) => !o.duCogs);
  const revenueDuCogs = du.reduce((s, o) => s + o.revenue, 0);
  const netSalesDuCogs = du.reduce((s, o) => s + o.netSales, 0);
  return {
    orderCount: orders.length,
    currency: pickMostCommon(orders.map((o) => o.currency)),
    subtotal: sum('subtotal'),
    gmv,
    refundedAmount: sum('refundedAmount'),
    netGmv,
    netSales,
    discount: sum('discount'),
    shippingRevenue: sum('shippingRevenue'),
    shippingCost: sum('shippingCost'),
    skuCost: sum('skuCost'),
    marginSp: sum('marginSp'),
    tax: sum('tax'),
    revenue,
    margin: netSalesDuCogs > 0 ? revenueDuCogs / netSalesDuCogs : 0,
    skuCostCoverage: orders.reduce((s, o) => s + o.skuCostCoverage, 0) / orders.length,
    soDonDuCogs: du.length, revenueDuCogs, netSalesDuCogs,
    soDonThieuCogs: thieu.length, netSalesThieuCogs: thieu.reduce((s, o) => s + o.netSales, 0),
  };
}

function pickMostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = ''; let max = 0;
  for (const [v, c] of counts) if (c > max) { best = v; max = c; }
  return best;
}
