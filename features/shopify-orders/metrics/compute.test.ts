import { describe, it, expect } from 'vitest';
import { computeOrderMetrics } from './compute';
import type { ComputeInput } from './compute';

function input(overrides: Partial<ComputeInput> = {}): ComputeInput {
  return {
    orderId: 'o-1',
    currency: 'USD',
    grossLineTotal: 100,
    totalDiscount: 0,
    totalShipping: 10,
    totalTax: 0,
    totalRefunded: 0,
    shippingCost: { amount: 8, rawAmount: 8, rawCurrency: 'USD', source: 'engine_estimate' },
    skuCosts: [
      { lineId: 'l-1', quantity: 1, costPerUnit: 30, costCurrency: 'USD' },
    ],
    ...overrides,
  };
}

describe('computeOrderMetrics', () => {
  it('preserves the raw cost-currency value through the pipeline (no FX round-trip)', () => {
    // A FedEx VN quote produces an exact integer (e.g. 1,034,000 VND) +
    // a 2dp USD derived value (~39.77). The dashboard must surface the
    // 1,034,000 verbatim, not 39.77 × 26,000 = 1,034,020 (off by ~20).
    const m = computeOrderMetrics(input({
      shippingCost: {
        amount: 39.77,
        rawAmount: 1_034_000,
        rawCurrency: 'VND',
        source: 'engine_estimate',
      },
    }));
    expect(m.shippingCost).toBe(39.77);
    expect(m.shippingCostRaw).toBe(1_034_000);
    expect(m.shippingCostRawCurrency).toBe('VND');
  });

  it('computes baseline revenue with no discount, no refund, invoice ship cost', () => {
    const m = computeOrderMetrics(input({
      shippingCost: { amount: 8, rawAmount: 8, rawCurrency: 'USD', source: 'invoice' },
    }));
    expect(m.gmv).toBe(100);
    expect(m.refundedAmount).toBe(0);
    expect(m.netGmv).toBe(100);
    expect(m.discount).toBe(0);
    expect(m.shippingRevenue).toBe(10);
    expect(m.shippingCost).toBe(8);
    expect(m.shippingCostSource).toBe('invoice');
    expect(m.skuCost).toBe(30);
    expect(m.skuCostCoverage).toBe(1);
    expect(m.revenue).toBe(72);
    expect(m.margin).toBeCloseTo(0.72, 4);
  });

  it('subtracts discount + refunds from netGmv before revenue', () => {
    const m = computeOrderMetrics(input({
      totalDiscount: 20,
      totalRefunded: 30,
    }));
    expect(m.netGmv).toBe(70);
    expect(m.revenue).toBe(22);
  });

  it('flags partial SKU cost coverage when a line has no cost row', () => {
    const m = computeOrderMetrics(input({
      skuCosts: [
        { lineId: 'l-1', quantity: 1, costPerUnit: 30, costCurrency: 'USD' },
        { lineId: 'l-2', quantity: 2, costPerUnit: null, costCurrency: null },
      ],
    }));
    expect(m.skuCost).toBe(30);
    expect(m.skuCostCoverage).toBe(0.5);
  });

  it('reports engine_estimate when no shipping invoice exists', () => {
    const m = computeOrderMetrics(input());
    expect(m.shippingCostSource).toBe('engine_estimate');
  });

  it('reports unknown ship source when both amount and source are absent', () => {
    const m = computeOrderMetrics(input({
      shippingCost: { amount: 0, rawAmount: 0, rawCurrency: 'USD', source: 'unknown' },
    }));
    expect(m.shippingCost).toBe(0);
    expect(m.shippingCostSource).toBe('unknown');
  });

  it('returns 0 margin when netGmv is 0 (avoids div-by-zero)', () => {
    const m = computeOrderMetrics(input({
      grossLineTotal: 0,
      totalRefunded: 0,
      shippingCost: { amount: 0, rawAmount: 0, rawCurrency: 'USD', source: 'invoice' },
      skuCosts: [],
    }));
    expect(m.netGmv).toBe(0);
    expect(m.margin).toBe(0);
  });
});
