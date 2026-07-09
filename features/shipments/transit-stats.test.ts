import { describe, it, expect } from 'vitest';
import { pivotRoutesByCountry, normalizeTransitRange, type TransitRouteStat } from './transit-stats';

const r = (carrierKey: string, country: string, deliveredN: number, avgDays: number | null): TransitRouteStat =>
  ({ carrierKey, country, shippedN: deliveredN + 2, deliveredN, avgDays, minDays: avgDays, maxDays: avgDays });

describe('pivotRoutesByCountry', () => {
  it('pivot nước × carrier, bỏ tuyến chưa có kiện giao', () => {
    const p = pivotRoutesByCountry([
      r('fedex', 'US', 10, 4.2), r('dhl', 'US', 5, 3.8),
      r('fedex', 'SA', 8, 8.1),
      r('dhl', 'GB', 0, null), // chưa giao → bỏ
    ]);
    expect(p.carriers).toEqual(['dhl', 'fedex']);
    expect(p.rows.map((x) => x.country)).toEqual(['US', 'SA']); // sắp theo tổng kiện giao
    expect(p.rows[0].byCarrier.fedex).toEqual({ avgDays: 4.2, deliveredN: 10 });
    expect(p.rows[0].byCarrier.dhl).toEqual({ avgDays: 3.8, deliveredN: 5 });
    expect(p.rows[1].byCarrier.dhl).toBeUndefined(); // SA chỉ có fedex
  });
  it('rỗng khi không có tuyến nào giao', () => {
    expect(pivotRoutesByCountry([r('fedex', 'US', 0, null)])).toEqual({ carriers: [], rows: [] });
  });
});

describe('normalizeTransitRange', () => {
  it('giá trị hợp lệ giữ nguyên, rác → 14', () => {
    expect(normalizeTransitRange('30')).toBe(30);
    expect(normalizeTransitRange('15')).toBe(14);
    expect(normalizeTransitRange(undefined)).toBe(14);
  });
});
