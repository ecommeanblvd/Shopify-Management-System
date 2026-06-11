import { describe, it, expect } from 'vitest';
import { computeShipComparison } from './ship-comparison';

describe('computeShipComparison', () => {
  const base = { orderCurrency: 'VND', costCurrency: 'VND', fxCostPerOrderCurrency: null,
    shippingRevenue: 200000, engineCostVnd: 150000, billedCostVnd: null, overrideVnd: null };
  it('(a) đơn VND: revVnd = revenue, biên theo engine khi chưa billed', () => {
    const r = computeShipComparison(base);
    expect(r.revVnd).toBe(200000); expect(r.costVnd).toBe(150000);
    expect(r.costBasis).toBe('engine'); expect(r.marginVnd).toBe(50000); expect(r.needsFx).toBe(false);
  });
  it('(b) đơn USD có FX: rev×fx, biên VND theo billed', () => {
    const r = computeShipComparison({ ...base, orderCurrency: 'USD', fxCostPerOrderCurrency: 25000,
      shippingRevenue: 10, billedCostVnd: 180000 });
    expect(r.revVnd).toBe(250000); expect(r.costVnd).toBe(180000);
    expect(r.costBasis).toBe('billed'); expect(r.marginVnd).toBe(70000);
  });
  it('(c) đơn USD thiếu FX → needsFx, không tính biên', () => {
    const r = computeShipComparison({ ...base, orderCurrency: 'USD', fxCostPerOrderCurrency: null });
    expect(r.needsFx).toBe(true); expect(r.revVnd).toBeNull(); expect(r.marginVnd).toBeNull();
  });
  it('(d) override đứng trên billed/engine', () => {
    const r = computeShipComparison({ ...base, billedCostVnd: 180000, overrideVnd: 120000 });
    expect(r.costVnd).toBe(120000); expect(r.costBasis).toBe('override');
  });
  it('(e) marginPct theo Rev', () => {
    const r = computeShipComparison(base);
    expect(r.marginPct).toBeCloseTo(25, 4); // 50000/200000
  });
  it('(f) rev 0 → marginPct null', () => {
    const r = computeShipComparison({ ...base, shippingRevenue: 0, engineCostVnd: 0 });
    expect(r.marginPct).toBeNull();
  });
});
