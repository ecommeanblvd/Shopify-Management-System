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
  netSales: 100,
  discount: 0,
  shippingRevenue: 10,
  shippingCost: 8,
  shippingCostRaw: 8,
  shippingCostRawCurrency: 'USD',
  shippingCostSource: 'invoice',
  shippingCostReason: null,
  skuCost: 30,
  skuCostCoverage: 1,
  duCogs: true,
  marginSp: 60,
  tax: 0,
  revenue: 72,
  margin: 0.72,
  ...overrides,
});

describe('aggregateMetrics', () => {
  it('sums fields across orders', () => {
    const agg = aggregateMetrics([
      baseMetric({ orderId: 'o1' }),
      baseMetric({ orderId: 'o2', gmv: 200, netGmv: 200, netSales: 200, revenue: 144 }),
    ]);
    expect(agg.orderCount).toBe(2);
    expect(agg.gmv).toBe(300);
    expect(agg.netGmv).toBe(300);
    expect(agg.revenue).toBe(216);
  });

  it('weighted-average margin = revenue / netSales across the set', () => {
    const agg = aggregateMetrics([
      baseMetric({ revenue: 50, netSales: 100 }),
      baseMetric({ revenue: 25, netSales: 100 }),
    ]);
    expect(agg.margin).toBeCloseTo(0.375, 4);
  });

  it('Margin % và Revenue KPI chỉ tính trên đơn ĐỦ COGS; đơn thiếu tách riêng (CEO 10/09/2026)', () => {
    const agg = aggregateMetrics([
      baseMetric({ orderId: 'du1', revenue: 50, netSales: 100 }),
      baseMetric({ orderId: 'du2', revenue: 25, netSales: 100 }),
      // Đơn thiếu COGS: SKU cost tính 0 nên revenue 95/100 là số giả → không được kéo margin lên.
      baseMetric({ orderId: 'thieu', revenue: 95, netSales: 100, skuCost: 0, skuCostCoverage: 0.5, duCogs: false }),
    ]);
    expect(agg.margin).toBeCloseTo(0.375, 4);
    expect(agg.soDonDuCogs).toBe(2); expect(agg.revenueDuCogs).toBe(75); expect(agg.netSalesDuCogs).toBe(200);
    expect(agg.soDonThieuCogs).toBe(1); expect(agg.netSalesThieuCogs).toBe(100);
    expect(agg.revenue).toBe(170); // tổng cũ vẫn giữ để tương thích
    expect(agg.netSales).toBe(300);
  });
  it('không có đơn nào đủ COGS → margin 0, không chia cho tổng net sales', () => {
    const agg = aggregateMetrics([baseMetric({ revenue: 95, netSales: 100, duCogs: false })]);
    expect(agg.margin).toBe(0); expect(agg.soDonDuCogs).toBe(0); expect(agg.netSalesThieuCogs).toBe(100);
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
