import { describe, it, expect } from 'vitest';
import { aggregateMetrics } from './aggregate';
import type { OrderMetrics } from './compute';

const baseMetric = (overrides: Partial<OrderMetrics>): OrderMetrics => ({
  orderId: 'o',
  currency: 'USD',
  subtotal: 90,
  gmv: 100,
  refundedAmount: 0,
  netGmv: 100,
  discount: 0,
  shippingRevenue: 10,
  shippingCost: 8,
  shippingCostRaw: 8,
  shippingCostRawCurrency: 'USD',
  shippingCostSource: 'invoice',
  shippingCostReason: null,
  skuCost: 30,
  skuCostCoverage: 1,
  tax: 0,
  revenue: 72,
  margin: 0.72,
  ...overrides,
});

describe('aggregateMetrics', () => {
  it('sums fields across orders', () => {
    const agg = aggregateMetrics([
      baseMetric({ orderId: 'o1' }),
      baseMetric({ orderId: 'o2', gmv: 200, netGmv: 200, revenue: 144 }),
    ]);
    expect(agg.orderCount).toBe(2);
    expect(agg.gmv).toBe(300);
    expect(agg.netGmv).toBe(300);
    expect(agg.revenue).toBe(216);
  });

  it('weighted-average margin = revenue / netGmv across the set', () => {
    const agg = aggregateMetrics([
      baseMetric({ revenue: 50, netGmv: 100 }),
      baseMetric({ revenue: 25, netGmv: 100 }),
    ]);
    expect(agg.margin).toBeCloseTo(0.375, 4);
  });

  it('treats an empty list as zero everything', () => {
    const agg = aggregateMetrics([]);
    expect(agg.orderCount).toBe(0);
    expect(agg.gmv).toBe(0);
    expect(agg.margin).toBe(0);
  });

  it('exposes the most-common currency (assumes single-currency window)', () => {
    const agg = aggregateMetrics([
      baseMetric({ currency: 'USD' }),
      baseMetric({ currency: 'USD' }),
      baseMetric({ currency: 'VND' }),
    ]);
    expect(agg.currency).toBe('USD');
  });
});
