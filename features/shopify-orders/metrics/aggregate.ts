import type { OrderMetrics } from './compute';

export interface AggregateMetrics {
  orderCount: number;
  currency: string;
  gmv: number;
  refundedAmount: number;
  netGmv: number;
  discount: number;
  shippingRevenue: number;
  shippingCost: number;
  skuCost: number;
  tax: number;
  revenue: number;
  margin: number;
  skuCostCoverage: number;
}

export function aggregateMetrics(orders: readonly OrderMetrics[]): AggregateMetrics {
  if (orders.length === 0) {
    return {
      orderCount: 0, currency: '',
      gmv: 0, refundedAmount: 0, netGmv: 0, discount: 0,
      shippingRevenue: 0, shippingCost: 0, skuCost: 0, tax: 0,
      revenue: 0, margin: 0, skuCostCoverage: 0,
    };
  }
  const sum = (k: keyof OrderMetrics) => orders.reduce((s, o) => s + (o[k] as number), 0);
  const gmv = sum('gmv');
  const netGmv = sum('netGmv');
  const revenue = sum('revenue');
  return {
    orderCount: orders.length,
    currency: pickMostCommon(orders.map((o) => o.currency)),
    gmv,
    refundedAmount: sum('refundedAmount'),
    netGmv,
    discount: sum('discount'),
    shippingRevenue: sum('shippingRevenue'),
    shippingCost: sum('shippingCost'),
    skuCost: sum('skuCost'),
    tax: sum('tax'),
    revenue,
    margin: netGmv > 0 ? revenue / netGmv : 0,
    skuCostCoverage: orders.reduce((s, o) => s + o.skuCostCoverage, 0) / orders.length,
  };
}

function pickMostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = ''; let max = 0;
  for (const [v, c] of counts) if (c > max) { best = v; max = c; }
  return best;
}
